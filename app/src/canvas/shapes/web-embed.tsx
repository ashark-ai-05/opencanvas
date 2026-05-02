import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { cardFrame, cardHeader, CardTitle, tag } from './shared';

export type WebEmbedShape = TLBaseShape<
  'llm-wiki:web-embed',
  {
    w: number;
    h: number;
    url: string;
    title?: string;
  }
>;

export class WebEmbedShapeUtil extends ShapeUtil<WebEmbedShape> {
  static override type = 'llm-wiki:web-embed' as const;

  static override props: RecordProps<WebEmbedShape> = {
    w: T.number,
    h: T.number,
    url: T.string,
    title: T.optional(T.string),
  };

  override getDefaultProps(): WebEmbedShape['props'] {
    return { w: 480, h: 320, url: 'about:blank' };
  }

  override getGeometry(shape: WebEmbedShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: WebEmbedShape) {
    let host: string;
    try {
      host = new URL(shape.props.url).host || shape.props.url;
    } catch {
      host = shape.props.url;
    }
    return (
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <CardTitle>{shape.props.title ?? host}</CardTitle>
          <span style={tag}>web</span>
        </div>
        <iframe
          src={shape.props.url}
          // sandbox restricts the iframe; allow scripts + same-origin off so
          // arbitrary web pages don't get our cookies. Add allow-popups
          // selectively if a use case demands it later.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{
            border: 'none',
            width: '100%',
            height: '100%',
            background: '#0a0a0a',
            flex: 1,
          }}
          title={shape.props.title ?? host}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: WebEmbedShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}
