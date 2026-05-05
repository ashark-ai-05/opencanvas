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
import { getEditor } from '../../state/editor-ref';

/**
 * Tasks shape — interactive checklist. Clicking the checkbox toggles
 * `done` and writes the change back through the editor so the canvas
 * snapshot persists. Backend never replays this kind of state — the
 * canvas is the source of truth for task completion.
 */
export type TaskItem = {
  id?: string;
  text: string;
  done?: boolean;
  assignee?: string;
  due?: string;
  priority?: string;
  url?: string;
};

export type TasksShape = TLBaseShape<
  'strata:tasks',
  {
    w: number;
    h: number;
    title: string;
    items: TaskItem[];
    source?: string;
    sources?: SourcePill[];
  }
>;

export class TasksShapeUtil extends ShapeUtil<TasksShape> {
  static override type = 'strata:tasks' as const;

  static override props: RecordProps<TasksShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    items: T.any,
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): TasksShape['props'] {
    return { w: 320, h: 260, title: 'Tasks', items: [] };
  }

  override getGeometry(shape: TasksShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TasksShape) {
    const items = Array.isArray(shape.props.items) ? shape.props.items : [];
    const completed = items.filter((i) => i.done).length;
    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{shape.props.title}</CardTitle>
            <Tag>{`${completed}/${items.length}`}</Tag>
            <CardActions shape={shape} />
          </CardHeader>
          <CardBody>
            <ul className="strata-tasks">
              {items.map((item, i) => (
                <TaskRow key={item.id ?? i} item={item} index={i} shape={shape} />
              ))}
            </ul>
          </CardBody>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: TasksShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: TasksShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}

function TaskRow({
  item,
  index,
  shape,
}: {
  item: TaskItem;
  index: number;
  shape: TasksShape;
}) {
  const toggle = () => {
    const editor = getEditor();
    if (!editor) return;
    const items = [...(shape.props.items ?? [])];
    const target = items[index];
    if (!target) return;
    items[index] = { ...target, done: !target.done };
    editor.updateShape({
      id: shape.id as never,
      type: 'strata:tasks' as never,
      props: { items } as never,
    } as never);
  };
  return (
    <li
      className="strata-tasks-row"
      data-done={item.done ? 'true' : 'false'}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={item.done === true}
        onChange={toggle}
        className="strata-tasks-checkbox"
        aria-label={item.text}
      />
      <span className="strata-tasks-text">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.text}
          </a>
        ) : (
          item.text
        )}
      </span>
      {item.priority && <Tag>{item.priority}</Tag>}
      {item.assignee && (
        <span className="strata-tasks-assignee">{item.assignee}</span>
      )}
      {item.due && <span className="strata-tasks-due">{item.due}</span>}
    </li>
  );
}
