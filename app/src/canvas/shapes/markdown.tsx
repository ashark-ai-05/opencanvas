import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cardBody, cardFrame, cardHeader, CardTitle, tag } from './shared';

export type MarkdownShape = TLBaseShape<
  'llm-wiki:markdown',
  {
    w: number;
    h: number;
    title?: string;
    body: string;
    uri?: string;
  }
>;

export class MarkdownShapeUtil extends ShapeUtil<MarkdownShape> {
  static override type = 'llm-wiki:markdown' as const;

  static override props: RecordProps<MarkdownShape> = {
    w: T.number,
    h: T.number,
    title: T.optional(T.string),
    body: T.string,
    uri: T.optional(T.string),
  };

  override getDefaultProps(): MarkdownShape['props'] {
    return { w: 360, h: 220, body: '' };
  }

  override getGeometry(shape: MarkdownShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: MarkdownShape) {
    return (
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <CardTitle>{shape.props.title ?? 'Document'}</CardTitle>
          <span style={tag}>md</span>
        </div>
        <div style={cardBody}>
          <div className="llm-wiki-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{shape.props.body}</ReactMarkdown>
          </div>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: MarkdownShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}
