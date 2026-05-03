import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { CardActions, CardFrame, CardHeader, CardTitle, CopyAction, Tag } from './shared';

export type CodeBlockShape = TLBaseShape<
  'strata:code-block',
  {
    w: number;
    h: number;
    title?: string;
    language?: string;
    code: string;
    /** Optional source path/URI shown in the header — agent can supply via payload.source. */
    source?: string;
    /** Legacy props kept so canvases saved before the agent-payload alignment still hydrate. */
    symbolName?: string;
    filePath?: string;
    uri?: string;
  }
>;

export class CodeBlockShapeUtil extends ShapeUtil<CodeBlockShape> {
  static override type = 'strata:code-block' as const;

  static override props: RecordProps<CodeBlockShape> = {
    w: T.number,
    h: T.number,
    title: T.optional(T.string),
    language: T.optional(T.string),
    code: T.string,
    source: T.optional(T.string),
    // Legacy
    symbolName: T.optional(T.string),
    filePath: T.optional(T.string),
    uri: T.optional(T.string),
  };

  override getDefaultProps(): CodeBlockShape['props'] {
    return { w: 480, h: 280, code: '' };
  }

  override getGeometry(shape: CodeBlockShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: CodeBlockShape) {
    // Title precedence: explicit title → source → legacy symbolName/filePath → 'Code'
    const titleParts: string[] = [];
    if (shape.props.title) titleParts.push(shape.props.title);
    else {
      if (shape.props.symbolName) titleParts.push(shape.props.symbolName);
      if (shape.props.filePath) titleParts.push(shape.props.filePath);
      else if (shape.props.source) titleParts.push(shape.props.source);
    }
    const title = titleParts.join(' · ') || 'Code';

    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {shape.props.language && <Tag>{shape.props.language}</Tag>}
            <CardActions
              shapeId={shape.id}
              extras={<CopyAction text={shape.props.code} label="code" />}
            />
          </CardHeader>
          <pre className="strata-card-body strata-card-body--mono" style={{ margin: 0 }}>
            {shape.props.code}
          </pre>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: CodeBlockShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override canResize() {
    return true;
  }
}
