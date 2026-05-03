import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { CardBody, CardFrame, CardHeader, CardTitle, Tag } from './shared';

type EventKind = 'commit' | 'deploy' | 'incident' | 'note' | 'release';
type Event = {
  timestamp: string;
  label: string;
  body?: string;
  /** kind comes through tldraw's runtime as `string | undefined` (T.string),
   *  we narrow to EventKind at render time for the styling lookup. */
  kind?: string;
};

export type TimelineShape = TLBaseShape<
  'strata:timeline',
  {
    w: number;
    h: number;
    title: string;
    events: Event[];
    uri?: string;
  }
>;

const KIND_DOT: Record<EventKind, string> = {
  commit: '#a78bfa',     // violet
  deploy: '#34d399',     // emerald
  incident: '#f87171',   // red
  note: '#71717a',       // zinc
  release: '#fbbf24',    // amber
};

export class TimelineShapeUtil extends ShapeUtil<TimelineShape> {
  static override type = 'strata:timeline' as const;

  static override props: RecordProps<TimelineShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    events: T.arrayOf(
      T.object({
        timestamp: T.string,
        label: T.string,
        body: T.optional(T.string),
        kind: T.optional(T.string),
      }),
    ),
    uri: T.optional(T.string),
  };

  override getDefaultProps(): TimelineShape['props'] {
    return { w: 400, h: 320, title: 'Timeline', events: [] };
  }

  override getGeometry(shape: TimelineShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TimelineShape) {
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title}</CardTitle>
            <Tag>{shape.props.events.length} events</Tag>
          </CardHeader>
          <CardBody>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', position: 'relative' }}>
              {/* Vertical guide line */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 6,
                  top: 6,
                  bottom: 6,
                  width: 1,
                  background: 'var(--color-line-2)',
                }}
              />
              {shape.props.events.map((e, i) => {
                const ek = e.kind as EventKind | undefined;
                const dotColor = ek && KIND_DOT[ek] ? KIND_DOT[ek] : '#71717a';
                return (
                  <li key={i} style={{ position: 'relative', paddingLeft: 22, paddingBottom: 14 }}>
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 5,
                        width: 13,
                        height: 13,
                        borderRadius: '50%',
                        background: dotColor,
                        boxShadow: `0 0 12px 0 ${dotColor}`,
                        border: '2px solid var(--color-bg-3)',
                      }}
                    />
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: '#71717a', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
                        {e.timestamp}
                      </span>
                      {e.kind && (
                        <span
                          style={{
                            fontSize: 9.5,
                            textTransform: 'uppercase',
                            letterSpacing: 0.06,
                            padding: '1px 6px',
                            borderRadius: 4,
                            color: dotColor,
                            border: `1px solid ${dotColor}55`,
                            background: `${dotColor}15`,
                          }}
                        >
                          {e.kind}
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 500, color: '#fafafa', marginTop: 2 }}>
                      {e.label}
                    </div>
                    {e.body && (
                      <div style={{ fontSize: 12.5, color: '#a1a1aa', marginTop: 3, lineHeight: 1.5 }}>
                        {e.body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: TimelineShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override canResize() {
    return true;
  }
}
