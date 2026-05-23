import { useEffect, useRef } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
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
  'opencanvas:sticky-note',
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
  static override type = 'opencanvas:sticky-note' as const;

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
        <StickyNoteView shape={shape} />
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

/**
 * Inner view extracted so we can use hooks (`useEditor` + `ResizeObserver`).
 *
 * Auto-grows the shape's `h` to match the rendered content height so the
 * coloured paper background always covers the body text — without this
 * the agent can place a sticky with a too-small h, the body overflows
 * the coloured area, and dark body text lands on the dark canvas at zero
 * contrast (the bug this fixes).
 *
 * Only ever grows. Manual resize via tldraw handles still works for
 * making it bigger; if the user shrinks below content it pops back next
 * frame, which is the desired "paper grows to fit" behaviour for sticky
 * notes (different from a fixed-bbox card where you'd want truncation).
 */
function StickyNoteView({ shape }: { shape: StickyNoteShape }) {
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const measured = Math.ceil(el.scrollHeight);
      // 4px tolerance prevents jitter from sub-pixel rounding while still
      // catching real content growth (added line, longer body, etc.).
      if (measured > shape.props.h + 4) {
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          props: { ...shape.props, h: measured },
        });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor, shape]);

  return (
    <div
      ref={ref}
      className="opencanvas-sticky"
      data-colour={shape.props.colour ?? 'yellow'}
      // min-height (not height) so the container can grow naturally on
      // the first frame, before the ResizeObserver writes the new h
      // back into the shape — keeps the coloured bg covering the text
      // even during that single-frame race.
      style={{ width: shape.props.w, minHeight: shape.props.h }}
    >
      <div className="opencanvas-sticky-actions">
        <CardActions
          shape={shape}
          extras={<CopyAction text={shape.props.body} label="note" />}
        />
      </div>
      <div className="opencanvas-sticky-body">{shape.props.body}</div>
      {shape.props.author && (
        <div className="opencanvas-sticky-author">— {shape.props.author}</div>
      )}
    </div>
  );
}
