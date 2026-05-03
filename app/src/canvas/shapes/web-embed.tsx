import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { resizeBox } from 'tldraw';
import { CardActions, CardFrame, CardHeader, CardTitle, OpenUrlAction, Tag } from './shared';

export type WebEmbedShape = TLBaseShape<
  'strata:web-embed',
  {
    w: number;
    h: number;
    url: string;
    title?: string;
    snippet?: string;
    source?: string;
  }
>;

export class WebEmbedShapeUtil extends ShapeUtil<WebEmbedShape> {
  static override type = 'strata:web-embed' as const;

  static override props: RecordProps<WebEmbedShape> = {
    w: T.number,
    h: T.number,
    url: T.string,
    title: T.optional(T.string),
    snippet: T.optional(T.string),
    source: T.optional(T.string),
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
    const showSnippet = !!shape.props.snippet && shape.props.snippet.length > 0;
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title ?? host}</CardTitle>
            <Tag>{host}</Tag>
            <CardActions
              shape={shape}
              extras={<OpenUrlAction url={shape.props.url} />}
            />
          </CardHeader>
          {showSnippet ? (
            <div className="strata-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0, color: '#d4d4d8' }}>{shape.props.snippet}</p>
              <a
                href={shape.props.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#c4b5fd',
                  fontSize: 12,
                  textDecoration: 'none',
                  borderTop: '1px solid rgba(63,63,70,0.5)',
                  paddingTop: 8,
                  marginTop: 'auto',
                }}
              >
                Open {host} ↗
              </a>
            </div>
          ) : (
            <iframe
              src={shape.props.url}
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
          )}
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: WebEmbedShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: WebEmbedShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}
