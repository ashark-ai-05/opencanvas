import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { resizeBox } from 'tldraw';
import {
  CardActions,
  CardBody,
  CardFrame,
  CardHeader,
  CardTitle,
  Tag,
  type SourcePill,
} from './shared';

/**
 * Kanban shape — drag-and-drop board. Phase 1: render-only (read state
 * from props). Drag-to-move can be added later as a meta mutation that
 * writes back to props through the editor.
 */
export type KanbanColour = 'neutral' | 'blue' | 'amber' | 'green' | 'rose' | 'violet';

export type KanbanCard = {
  id?: string;
  title: string;
  body?: string;
  assignee?: string;
  priority?: string;
  tag?: string;
  url?: string;
};

export type KanbanColumn = {
  id?: string;
  name: string;
  colour?: KanbanColour;
  cards: KanbanCard[];
};

export type KanbanShape = TLBaseShape<
  'opencanvas:kanban',
  {
    w: number;
    h: number;
    title: string;
    columns: KanbanColumn[];
    source?: string;
    sources?: SourcePill[];
  }
>;

export class KanbanShapeUtil extends ShapeUtil<KanbanShape> {
  static override type = 'opencanvas:kanban' as const;

  static override props: RecordProps<KanbanShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    columns: T.any,
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): KanbanShape['props'] {
    return {
      w: 720,
      h: 360,
      title: 'Board',
      columns: [
        { name: 'To do', cards: [] },
        { name: 'Doing', cards: [] },
        { name: 'Done', cards: [] },
      ],
    };
  }

  override getGeometry(shape: KanbanShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: KanbanShape) {
    const columns = Array.isArray(shape.props.columns) ? shape.props.columns : [];
    const totalCards = columns.reduce(
      (acc, c) => acc + (Array.isArray(c.cards) ? c.cards.length : 0),
      0,
    );
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title}</CardTitle>
            <Tag>{`${totalCards} cards`}</Tag>
            <CardActions shape={shape} />
          </CardHeader>
          <CardBody>
            <div className="opencanvas-kanban">
              {columns.map((col, ci) => (
                <div
                  key={col.id ?? ci}
                  className="opencanvas-kanban-col"
                  data-colour={col.colour ?? 'neutral'}
                >
                  <div className="opencanvas-kanban-col-header">
                    <span>{col.name}</span>
                    <Tag>{(col.cards ?? []).length}</Tag>
                  </div>
                  <ul className="opencanvas-kanban-cards">
                    {(col.cards ?? []).map((card, cdi) => (
                      <li
                        key={card.id ?? cdi}
                        className="opencanvas-kanban-card"
                      >
                        <div className="opencanvas-kanban-card-title">
                          {card.url ? (
                            <a href={card.url} target="_blank" rel="noopener noreferrer">
                              {card.title}
                            </a>
                          ) : (
                            card.title
                          )}
                        </div>
                        {card.body && (
                          <div className="opencanvas-kanban-card-body">{card.body}</div>
                        )}
                        <div className="opencanvas-tag-row">
                          {card.priority && <Tag>{card.priority}</Tag>}
                          {card.tag && <Tag accent>{card.tag}</Tag>}
                          {card.assignee && (
                            <span className="opencanvas-kanban-card-assignee">
                              {card.assignee}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardBody>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: KanbanShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: KanbanShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}
