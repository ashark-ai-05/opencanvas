import type { SourcePill } from './shared';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { resizeBox } from 'tldraw';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CardActions,
  CardBody,
  CardFrame,
  CardHeader,
  CardTitle,
  CopyAction,
  Tag,
} from './shared';

export type MarkdownShape = TLBaseShape<
  'opencanvas:markdown',
  {
    w: number;
    h: number;
    title?: string;
    body: string;
    uri?: string;
    source?: string;
    sources?: SourcePill[];
  }
>;

export class MarkdownShapeUtil extends ShapeUtil<MarkdownShape> {
  static override type = 'opencanvas:markdown' as const;

  static override props: RecordProps<MarkdownShape> = {
    w: T.number,
    h: T.number,
    title: T.optional(T.string),
    body: T.string,
    uri: T.optional(T.string),
    source: T.optional(T.string),
    sources: T.optional(T.any),
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
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title ?? 'Document'}</CardTitle>
            <Tag>md</Tag>
            <CardActions
              shape={shape}
              extras={<CopyAction text={shape.props.body} label="markdown" />}
            />
          </CardHeader>
          <CardBody>
            <div className="opencanvas-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{shape.props.body}</ReactMarkdown>
            </div>
          </CardBody>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: MarkdownShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: MarkdownShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}
