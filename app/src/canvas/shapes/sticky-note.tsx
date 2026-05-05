import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { resizeBox } from 'tldraw';
import { CardActions, CopyAction, type SourcePill } from './shared';

/**
 * Sticky-note shape — small, paper-styled callout. Different visual
 * language from CardFrame on purpose: full-bleed colour, rounded
 * corners, no header bar. Hover-actions still appear at the top-right.
 */
export type StickyColour =
  | 'yellow'
  | 'pink'
  | 'blue'
  | 'green'
  | 'violet'
  | 'orange';

export type StickyNoteShape = TLBaseShape<
  'strata:sticky-note',
  {
    w: number;
    h: number;
    body: string;
    author?: string;
    colour?: StickyColour;
    source?: string;
    sources?: SourcePill[];
  }
>;

export class StickyNoteShapeUtil extends ShapeUtil<StickyNoteShape> {
  static override type = 'strata:sticky-note' as const;

  static override props: RecordProps<StickyNoteShape> = {
    w: T.number,
    h: T.number,
    body: T.string,
    author: T.optional(T.string),
    colour: T.optional(T.any),
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): StickyNoteShape['props'] {
    return { w: 200, h: 200, body: '', colour: 'yellow' };
  }

  override getGeometry(shape: StickyNoteShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: StickyNoteShape) {
    return (
      <HTMLContainer>
        <div
          className="strata-sticky"
          data-colour={shape.props.colour ?? 'yellow'}
          style={{ width: shape.props.w, height: shape.props.h }}
        >
          <div className="strata-sticky-actions">
            <CardActions
              shape={shape}
              extras={<CopyAction text={shape.props.body} label="note" />}
            />
          </div>
          <div className="strata-sticky-body">{shape.props.body}</div>
          {shape.props.author && (
            <div className="strata-sticky-author">— {shape.props.author}</div>
          )}
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: StickyNoteShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={6} />;
  }

  override onResize(shape: StickyNoteShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}
