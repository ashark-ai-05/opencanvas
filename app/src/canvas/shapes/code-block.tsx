import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { cardFrame, cardHeader, CardTitle, monoBody, tag } from './shared';

export type CodeBlockShape = TLBaseShape<
  'llm-wiki:code-block',
  {
    w: number;
    h: number;
    language?: string;
    symbolName?: string;
    filePath?: string;
    body: string;
    uri?: string;
  }
>;

export class CodeBlockShapeUtil extends ShapeUtil<CodeBlockShape> {
  static override type = 'llm-wiki:code-block' as const;

  static override props: RecordProps<CodeBlockShape> = {
    w: T.number,
    h: T.number,
    language: T.optional(T.string),
    symbolName: T.optional(T.string),
    filePath: T.optional(T.string),
    body: T.string,
    uri: T.optional(T.string),
  };

  override getDefaultProps(): CodeBlockShape['props'] {
    return { w: 480, h: 280, body: '' };
  }

  override getGeometry(shape: CodeBlockShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: CodeBlockShape) {
    const titleParts: string[] = [];
    if (shape.props.symbolName) titleParts.push(shape.props.symbolName);
    if (shape.props.filePath) titleParts.push(shape.props.filePath);
    const title = titleParts.join(' · ') || 'Code';

    return (
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <CardTitle>{title}</CardTitle>
          {shape.props.language && <span style={tag}>{shape.props.language}</span>}
        </div>
        <pre style={{ ...monoBody, margin: 0 }}>{shape.props.body}</pre>
      </HTMLContainer>
    );
  }

  override indicator(shape: CodeBlockShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}
