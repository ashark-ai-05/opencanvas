import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { T } from 'tldraw';
import { CardBody, CardFrame, CardHeader, CardTitle } from './shared';

export type TextNoteShape = TLBaseShape<
  'opencanvas:text-note',
  {
    w: number;
    h: number;
    text: string;
  }
>;

export class TextNoteShapeUtil extends ShapeUtil<TextNoteShape> {
  static override type = 'opencanvas:text-note' as const;

  static override props: RecordProps<TextNoteShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
  };

  override getDefaultProps(): TextNoteShape['props'] {
    return { w: 240, h: 120, text: 'Text note' };
  }

  override getGeometry(shape: TextNoteShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TextNoteShape) {
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>Note</CardTitle>
          </CardHeader>
          <CardBody>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{shape.props.text}</div>
          </CardBody>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: TextNoteShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override canResize() {
    return true;
  }
}
