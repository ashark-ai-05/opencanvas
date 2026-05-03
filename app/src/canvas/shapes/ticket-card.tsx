import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { CardActions, CardBody, CardFrame, CardHeader, CardTitle, CopyAction } from './shared';

export type TicketCardShape = TLBaseShape<
  'strata:ticket',
  {
    w: number;
    h: number;
    ticketId: string;
    title: string;
    status?: string;
    assignee?: string;
    priority?: string;
    description?: string;
    uri?: string;
  }
>;

const STATUS_PALETTE: Record<string, { bg: string; fg: string; border: string }> = {
  todo:           { bg: 'rgba(113,113,122,0.18)', fg: '#d4d4d8', border: 'rgba(113,113,122,0.4)' },
  'in-progress':  { bg: 'rgba(245,158,11,0.18)',  fg: '#fde68a', border: 'rgba(245,158,11,0.5)' },
  done:           { bg: 'rgba(16,185,129,0.18)',  fg: '#6ee7b7', border: 'rgba(16,185,129,0.5)' },
  blocked:        { bg: 'rgba(239,68,68,0.18)',   fg: '#fca5a5', border: 'rgba(239,68,68,0.5)' },
};

export class TicketCardShapeUtil extends ShapeUtil<TicketCardShape> {
  static override type = 'strata:ticket' as const;

  static override props: RecordProps<TicketCardShape> = {
    w: T.number,
    h: T.number,
    ticketId: T.string,
    title: T.string,
    status: T.optional(T.string),
    assignee: T.optional(T.string),
    priority: T.optional(T.string),
    description: T.optional(T.string),
    uri: T.optional(T.string),
  };

  override getDefaultProps(): TicketCardShape['props'] {
    return {
      w: 320,
      h: 200,
      ticketId: 'TICKET-?',
      title: 'Untitled ticket',
    };
  }

  override getGeometry(shape: TicketCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TicketCardShape) {
    const status = shape.props.status;
    const palette = status ? STATUS_PALETTE[status] : undefined;
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <span className="strata-tag" style={{ fontFamily: 'ui-monospace, monospace' }}>
              {shape.props.ticketId}
            </span>
            <CardTitle>{shape.props.title}</CardTitle>
            {status && (
              <span
                className="strata-tag"
                style={
                  palette
                    ? { background: palette.bg, color: palette.fg, borderColor: palette.border }
                    : undefined
                }
              >
                {status}
              </span>
            )}
            <CardActions
              shape={shape}
              extras={
                <CopyAction text={shape.props.ticketId} label="ticket id" />
              }
            />
          </CardHeader>
          <CardBody>
            {(shape.props.assignee || shape.props.priority) && (
              <div style={{ marginBottom: 8, color: '#a1a1aa', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {shape.props.assignee && (
                  <span>
                    <span style={{ color: '#71717a' }}>assignee · </span>
                    {shape.props.assignee}
                  </span>
                )}
                {shape.props.priority && (
                  <span>
                    <span style={{ color: '#71717a' }}>priority · </span>
                    {shape.props.priority}
                  </span>
                )}
              </div>
            )}
            {shape.props.description && (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {shape.props.description}
              </div>
            )}
          </CardBody>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: TicketCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override canResize() {
    return true;
  }
}
