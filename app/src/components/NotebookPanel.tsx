import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListTodo,
  Notebook,
  Trash2,
  X,
} from 'lucide-react';
import { DepthPanel } from './primitives';
import { useNotebookStore, type Task } from '../state/notebook-store';

// ---------------------------------------------------------------------------
// Public shell — thin wrapper matching PluginsPanel / RecallPanel pattern
// ---------------------------------------------------------------------------

interface NotebookPanelProps {
  open: boolean;
  onClose: () => void;
}

export function NotebookPanel({ open, onClose }: NotebookPanelProps) {
  return (
    <DepthPanel
      open={open}
      onClose={onClose}
      placement="right"
      width="480px"
      ariaLabel="Notebook"
    >
      <NotebookPanelBody onClose={onClose} />
    </DepthPanel>
  );
}

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type TabKey = 'notes' | 'tasks' | 'calendar';

// ---------------------------------------------------------------------------
// Body — header + tab nav + tab content
// ---------------------------------------------------------------------------

function NotebookPanelBody({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabKey>('notes');
  const [tasksFilter, setTasksFilter] = useState<{ dueDate: string } | null>(
    null,
  );

  const goToTasksForDate = (dueDate: string) => {
    setTasksFilter({ dueDate });
    setTab('tasks');
  };

  const handleTabChange = (next: TabKey) => {
    // Clear filter when manually switching tabs away from tasks
    if (next !== 'tasks') setTasksFilter(null);
    setTab(next);
  };

  return (
    <>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-line, rgba(255,255,255,0.06))',
          flexShrink: 0,
        }}
      >
        <Notebook className="size-4" style={{ color: 'var(--color-accent)' }} />
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-fg)',
          }}
        >
          Notebook
        </h2>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close Notebook"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 6,
            background: 'transparent',
            border: '1px solid transparent',
            color: 'var(--color-muted)',
            cursor: 'pointer',
          }}
        >
          <X className="size-3.5" />
        </button>
      </header>

      {/* Tab nav */}
      <nav
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-line, rgba(255,255,255,0.06))',
          flexShrink: 0,
        }}
        aria-label="Notebook tabs"
      >
        <TabButton
          active={tab === 'notes'}
          onClick={() => handleTabChange('notes')}
          icon={<FileText className="size-3.5" />}
          label="Notes"
        />
        <TabButton
          active={tab === 'tasks'}
          onClick={() => handleTabChange('tasks')}
          icon={<ListTodo className="size-3.5" />}
          label="Tasks"
        />
        <TabButton
          active={tab === 'calendar'}
          onClick={() => handleTabChange('calendar')}
          icon={<CalendarDays className="size-3.5" />}
          label="Calendar"
        />
      </nav>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'notes' && <NotesTab />}
        {tab === 'tasks' && (
          <TasksTab
            filter={tasksFilter}
            onClearFilter={() => setTasksFilter(null)}
          />
        )}
        {tab === 'calendar' && (
          <CalendarTab onDateClick={goToTasksForDate} />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// TabButton
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        borderRadius: 7,
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        border: active
          ? '1px solid rgba(167,139,250,0.30)'
          : '1px solid transparent',
        background: active
          ? 'rgba(167,139,250,0.12)'
          : 'transparent',
        color: active ? '#ddd6fe' : 'var(--color-muted)',
        transition: 'all 0.12s',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Notes tab — side-by-side markdown editor + preview
// ---------------------------------------------------------------------------

function NotesTab() {
  const note = useNotebookStore((s) => s.note);
  const fetchNote = useNotebookStore((s) => s.fetchNote);
  const saveNote = useNotebookStore((s) => s.saveNote);
  const [draft, setDraft] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchNote();
  }, [fetchNote]);

  // Sync draft from store when note loads (keyed by updatedAt to avoid
  // overwriting in-progress typing if a background save returns).
  useEffect(() => {
    if (note) setDraft(note.body);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.updatedAt]);

  const handleChange = (next: string) => {
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveNote(next), 600);
  };

  const sharedPaneStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    height: '100%',
    padding: 12,
    background: 'var(--color-bg-2, rgba(255,255,255,0.025))',
    border: '1px solid var(--color-line, rgba(255,255,255,0.06))',
    borderRadius: 8,
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
        padding: 12,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Editor pane */}
      <textarea
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck
        placeholder={'# Markdown notes…\n\nAnything you write here is saved automatically.'}
        style={{
          ...sharedPaneStyle,
          resize: 'none',
          fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--color-fg)',
          outline: 'none',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'rgba(167,139,250,0.55)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor =
            'var(--color-line, rgba(255,255,255,0.06))';
        }}
        aria-label="Markdown notes editor"
      />

      {/* Preview pane */}
      <div
        style={{
          ...sharedPaneStyle,
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--color-fg)',
        }}
      >
        <style>{`
          .nb-md-preview h1,
          .nb-md-preview h2,
          .nb-md-preview h3 {
            color: var(--color-fg);
            margin: 0.75em 0 0.35em;
            font-weight: 600;
            line-height: 1.3;
          }
          .nb-md-preview h1 { font-size: 1.25em; }
          .nb-md-preview h2 { font-size: 1.1em; }
          .nb-md-preview h3 { font-size: 1em; }
          .nb-md-preview p { margin: 0 0 0.6em; }
          .nb-md-preview ul,
          .nb-md-preview ol { margin: 0 0 0.6em; padding-left: 1.4em; }
          .nb-md-preview li { margin-bottom: 0.25em; }
          .nb-md-preview code {
            font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
            font-size: 0.87em;
            padding: 1px 5px;
            border-radius: 4px;
            background: rgba(255,255,255,0.07);
          }
          .nb-md-preview pre {
            padding: 10px 12px;
            border-radius: 7px;
            background: rgba(255,255,255,0.05);
            overflow-x: auto;
            margin: 0 0 0.6em;
          }
          .nb-md-preview pre code {
            background: none;
            padding: 0;
          }
          .nb-md-preview blockquote {
            border-left: 3px solid rgba(167,139,250,0.4);
            margin: 0 0 0.6em;
            padding-left: 12px;
            color: var(--color-muted);
          }
          .nb-md-preview a { color: #a78bfa; }
          .nb-md-preview hr {
            border: none;
            border-top: 1px solid rgba(255,255,255,0.08);
            margin: 0.75em 0;
          }
          .nb-md-preview table {
            border-collapse: collapse;
            width: 100%;
            margin-bottom: 0.6em;
            font-size: 0.92em;
          }
          .nb-md-preview th,
          .nb-md-preview td {
            border: 1px solid rgba(255,255,255,0.10);
            padding: 4px 8px;
          }
          .nb-md-preview th { background: rgba(255,255,255,0.04); font-weight: 600; }
          .nb-md-preview input[type="checkbox"] { margin-right: 5px; }
        `}</style>
        <div className="nb-md-preview">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {draft || '_Preview appears here as you type._'}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks tab
// ---------------------------------------------------------------------------

function TasksTab({
  filter,
  onClearFilter,
}: {
  filter: { dueDate: string } | null;
  onClearFilter: () => void;
}) {
  const tasks = useNotebookStore((s) => s.tasks);
  const fetchTasks = useNotebookStore((s) => s.fetchTasks);
  const createTask = useNotebookStore((s) => s.createTask);
  const updateTask = useNotebookStore((s) => s.updateTask);
  const deleteTask = useNotebookStore((s) => s.deleteTask);

  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const visible = filter
    ? tasks.filter((t) => t.dueDate === filter.dueDate)
    : tasks;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSubmitting(true);
    await createTask({
      title: newTitle.trim(),
      dueDate: newDueDate || null,
    });
    setNewTitle('');
    setNewDueDate('');
    setSubmitting(false);
  };

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 7,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.10)',
    color: 'var(--color-fg)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        overflowY: 'auto',
        flex: 1,
      }}
    >
      {/* New task form */}
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
        aria-label="Add new task"
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New task…"
          aria-label="Task title"
          style={{ ...inputStyle, flex: 1 }}
          disabled={submitting}
        />
        <input
          type="date"
          value={newDueDate}
          onChange={(e) => setNewDueDate(e.target.value)}
          aria-label="Due date"
          style={{ ...inputStyle, width: 140, cursor: 'pointer' }}
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || !newTitle.trim()}
          aria-label="Add task"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: 7,
            background: 'rgba(167,139,250,0.14)',
            border: '1px solid rgba(167,139,250,0.28)',
            color: '#ddd6fe',
            fontSize: 18,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.6 : 1,
            flexShrink: 0,
          }}
        >
          +
        </button>
      </form>

      {/* Filter pill */}
      {filter && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 10px',
            borderRadius: 7,
            background: 'rgba(167,139,250,0.10)',
            border: '1px solid rgba(167,139,250,0.22)',
            fontSize: 12,
            color: '#ddd6fe',
          }}
        >
          <span style={{ flex: 1 }}>Showing tasks for {filter.dueDate}</span>
          <button
            type="button"
            onClick={onClearFilter}
            style={{
              padding: '2px 8px',
              borderRadius: 5,
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--color-muted)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Task list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visible.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            onToggle={() => updateTask(t.id, { done: !t.done })}
            onDelete={() => deleteTask(t.id)}
          />
        ))}
        {visible.length === 0 && (
          <div
            style={{
              padding: '20px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.06)',
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--color-muted)',
            }}
          >
            No tasks{filter ? ' for this day' : ''}.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskRow
// ---------------------------------------------------------------------------

function dueDateColor(dueDate: string | null): string {
  if (!dueDate) return 'var(--color-muted)';
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return '#f87171'; // overdue — rose
  if (dueDate === today) return '#fbbf24'; // today — amber
  return 'var(--color-muted)'; // future — muted
}

function dueDateBg(dueDate: string | null): string {
  if (!dueDate) return 'rgba(255,255,255,0.04)';
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return 'rgba(248,113,113,0.10)';
  if (dueDate === today) return 'rgba(251,191,36,0.10)';
  return 'rgba(255,255,255,0.04)';
}

function TaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 10px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.06)',
        opacity: task.done ? 0.55 : 1,
        transition: 'opacity 0.12s',
      }}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={task.done}
        onChange={onToggle}
        aria-label={`Mark "${task.title}" as ${task.done ? 'incomplete' : 'complete'}`}
        style={{ cursor: 'pointer', flexShrink: 0, accentColor: '#a78bfa' }}
      />

      {/* Title */}
      <span
        style={{
          flex: 1,
          fontSize: 13,
          color: 'var(--color-fg)',
          textDecoration: task.done ? 'line-through' : 'none',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {task.title}
      </span>

      {/* Due date pill */}
      {task.dueDate && (
        <span
          style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 5,
            background: dueDateBg(task.dueDate),
            color: dueDateColor(task.dueDate),
            border: `1px solid ${dueDateColor(task.dueDate)}33`,
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {task.dueDate}
        </span>
      )}

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete task: ${task.title}`}
        title="Delete task"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: 5,
          background: 'transparent',
          border: '1px solid transparent',
          color: '#f87171',
          cursor: 'pointer',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.12s',
          flexShrink: 0,
        }}
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar tab — hand-rolled month grid (no date-fns dependency)
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function CalendarTab({ onDateClick }: { onDateClick: (dueDate: string) => void }) {
  const tasksByMonth = useNotebookStore((s) => s.tasksByMonth);
  const fetchTasksByMonth = useNotebookStore((s) => s.fetchTasksByMonth);

  const [month, setMonth] = useState<{ year: number; m: number }>(() => {
    const d = new Date();
    return { year: d.getFullYear(), m: d.getMonth() };
  });

  const ym = `${month.year}-${String(month.m + 1).padStart(2, '0')}`;
  const tasks = tasksByMonth[ym] ?? [];

  useEffect(() => {
    fetchTasksByMonth(ym);
  }, [ym, fetchTasksByMonth]);

  // Build a map: 'YYYY-MM-DD' → Task[]
  const tasksByDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const arr = tasksByDay.get(t.dueDate) ?? [];
    arr.push(t);
    tasksByDay.set(t.dueDate, arr);
  }

  // Calendar math — no external deps
  const firstDayOfMonth = new Date(month.year, month.m, 1);
  const startWeekday = firstDayOfMonth.getDay(); // 0=Sun
  const daysInMonth = new Date(month.year, month.m + 1, 0).getDate();

  // Build grid cells: nulls for leading empty days, then 1..daysInMonth
  const cells: (number | null)[] = [
    ...Array<null>(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  const prevMonth = () =>
    setMonth(({ year, m }) =>
      m === 0 ? { year: year - 1, m: 11 } : { year, m: m - 1 },
    );
  const nextMonth = () =>
    setMonth(({ year, m }) =>
      m === 11 ? { year: year + 1, m: 0 } : { year, m: m + 1 },
    );

  return (
    <div
      style={{
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflowY: 'auto',
        flex: 1,
      }}
    >
      {/* Month navigation header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Previous month"
          style={navBtnStyle}
        >
          <ChevronLeft className="size-4" />
        </button>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-fg)',
          }}
        >
          {MONTH_NAMES[month.m]} {month.year}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Next month"
          style={navBtnStyle}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Weekday header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 2,
        }}
      >
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            style={{
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-muted)',
              padding: '4px 0',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 2,
        }}
      >
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} style={{ minHeight: 52 }} />;
          }

          const dateStr = `${ym}-${String(day).padStart(2, '0')}`;
          const dayTasks = tasksByDay.get(dateStr) ?? [];
          const hasTasks = dayTasks.length > 0;
          const isToday = dateStr === todayStr;

          return (
            <CalendarCell
              key={dateStr}
              day={day}
              dateStr={dateStr}
              tasks={dayTasks}
              hasTasks={hasTasks}
              isToday={isToday}
              onClick={() => {
                if (hasTasks) onDateClick(dateStr);
              }}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          marginTop: 4,
          fontSize: 11,
          color: 'var(--color-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#a78bfa',
            }}
          />
          Tasks due
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              border: '2px solid rgba(167,139,250,0.8)',
            }}
          />
          Today
        </span>
      </div>
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'var(--color-muted)',
  cursor: 'pointer',
};

function CalendarCell({
  day,
  dateStr,
  tasks,
  hasTasks,
  isToday,
  onClick,
}: {
  day: number;
  dateStr: string;
  tasks: Task[];
  hasTasks: boolean;
  isToday: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const dotCount = Math.min(tasks.length, 3);
  const extra = tasks.length > 3 ? tasks.length - 3 : 0;

  return (
    <div
      role={hasTasks ? 'button' : undefined}
      tabIndex={hasTasks ? 0 : undefined}
      aria-label={
        hasTasks
          ? `${dateStr}: ${tasks.length} task${tasks.length === 1 ? '' : 's'}`
          : dateStr
      }
      onClick={onClick}
      onKeyDown={(e) => {
        if (hasTasks && (e.key === 'Enter' || e.key === ' ')) onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        minHeight: 52,
        padding: '5px 4px 4px',
        borderRadius: 7,
        border: isToday
          ? '1.5px solid rgba(167,139,250,0.65)'
          : '1px solid rgba(255,255,255,0.05)',
        background: hasTasks
          ? hovered
            ? 'rgba(167,139,250,0.14)'
            : 'rgba(167,139,250,0.07)'
          : hovered
          ? 'rgba(255,255,255,0.04)'
          : 'transparent',
        cursor: hasTasks ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        transition: 'background 0.12s, border-color 0.12s',
        userSelect: 'none',
      }}
    >
      {/* Day number */}
      <span
        style={{
          fontSize: 12,
          fontWeight: isToday ? 700 : 400,
          color: isToday ? '#ddd6fe' : 'var(--color-fg)',
          lineHeight: 1,
        }}
      >
        {day}
      </span>

      {/* Task dots */}
      {hasTasks && (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}
        >
          {Array.from({ length: dotCount }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: '#a78bfa',
                opacity: 0.85,
                flexShrink: 0,
              }}
            />
          ))}
          {extra > 0 && (
            <span style={{ fontSize: 9, color: 'var(--color-muted)', lineHeight: 1 }}>
              +{extra}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
