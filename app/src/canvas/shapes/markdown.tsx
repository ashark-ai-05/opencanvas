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
  'strata:markdown',
  {
    w: number;
    h: number;
    title?: string;
    body: string;
    uri?: string;
  }
>;

export class MarkdownShapeUtil extends ShapeUtil<MarkdownShape> {
  static override type = 'strata:markdown' as const;

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
            <div className="strata-markdown">
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

  override canResize() {
    return true;
  }
}
