import { useEffect, useState } from 'react';
import { CalendarClock, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { DepthPanel } from './primitives';
import { useConversationsStore } from '../state/conversations-store';

export type Schedule = {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  conversationId: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  createdAt: number;
};

interface SchedulesPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SchedulesPanel({ open, onClose }: SchedulesPanelProps) {
  return (
    <DepthPanel
      open={open}
      onClose={onClose}
      placement="right"
      width="440px"
      ariaLabel="Scheduled agents"
    >
      <SchedulesPanelBody onClose={onClose} />
    </DepthPanel>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ms: number | undefined, prefix: string): string {
  if (!ms) return '—';
  const diff = Math.abs(Date.now() - ms);
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  const suffix =
    days >= 1 ? `${days}d` : hours >= 1 ? `${hours}h` : `${mins}m`;
  return `${prefix} ${suffix}`;
}

// ---------------------------------------------------------------------------
// Body sub-component
// ---------------------------------------------------------------------------

function SchedulesPanelBody({ onClose }: { onClose: () => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const conversations = useConversationsStore((s) => s.conversations);

  const refresh = () => {
    fetch('/v1/schedules')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { schedules?: Schedule[] } | null) => {
        if (data?.schedules) setSchedules(data.schedules);
      })
      .catch(() => {
        /* silently ignore — backend may be starting */
      });
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleDelete = async (s: Schedule) => {
    if (!window.confirm(`Delete schedule "${s.name}"?`)) return;
    try {
      const res = await fetch(`/v1/schedules/${s.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      refresh();
    } catch (e) {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleToggle = async (s: Schedule) => {
    try {
      const res = await fetch(`/v1/schedules/${s.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      refresh();
    } catch (e) {
      toast.error(`Toggle failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRunNow = async (s: Schedule) => {
    try {
      const res = await fetch(`/v1/schedules/${s.id}/run`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      toast.success('Scheduled agent started.');
      refresh();
    } catch (e) {
      toast.error(`Run failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleEdit = (s: Schedule) => {
    setEditingId(s.id);
    setFormOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setEditingId(null);
  };

  const handleFormSave = () => {
    handleFormClose();
    refresh();
  };

  const editingSchedule = editingId
    ? schedules.find((s) => s.id === editingId)
    : undefined;

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
        <CalendarClock className="size-4" style={{ color: 'var(--color-accent)' }} />
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-fg)',
          }}
        >
          Scheduled agents
        </h2>
        {schedules.length > 0 && (
          <span
            style={{
              marginLeft: 4,
              padding: '1px 7px',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 500,
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--color-muted)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {schedules.length}
          </span>
        )}
        {/* + New schedule button */}
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setFormOpen((v) => !v);
          }}
          title="New schedule"
          aria-label="New schedule"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 7,
            background: 'rgba(167,139,250,0.10)',
            border: '1px solid rgba(167,139,250,0.22)',
            color: '#ddd6fe',
            fontSize: 12,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Plus className="size-3.5" />
          New
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          style={{
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

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Inline form */}
        {formOpen && (
          <ScheduleForm
            initial={editingSchedule}
            conversations={conversations}
            onSave={handleFormSave}
            onCancel={handleFormClose}
          />
        )}

        {/* Empty state */}
        {schedules.length === 0 && !formOpen && (
          <div
            style={{
              padding: '20px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: 13,
              color: 'var(--color-fg-2)',
              textAlign: 'center',
            }}
          >
            <p style={{ margin: '0 0 10px' }}>No scheduled agents yet.</p>
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 12px',
                borderRadius: 7,
                background: 'rgba(167,139,250,0.10)',
                border: '1px solid rgba(167,139,250,0.22)',
                color: '#ddd6fe',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Plus className="size-3.5" />
              New schedule
            </button>
          </div>
        )}

        {/* Schedule rows */}
        {schedules.map((s) => (
          <ScheduleRow
            key={s.id}
            schedule={s}
            conversationTitle={
              conversations.find((c) => c.id === s.conversationId)?.title ?? s.conversationId
            }
            onEdit={() => handleEdit(s)}
            onDelete={() => handleDelete(s)}
            onToggle={() => handleToggle(s)}
            onRunNow={() => handleRunNow(s)}
          />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ScheduleRow
// ---------------------------------------------------------------------------

function ScheduleRow({
  schedule,
  conversationTitle,
  onEdit,
  onDelete,
  onToggle,
  onRunNow,
}: {
  schedule: Schedule;
  conversationTitle: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onRunNow: () => void;
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.025)',
        border: `1px solid ${schedule.enabled ? 'rgba(167,139,250,0.14)' : 'rgba(255,255,255,0.06)'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        opacity: schedule.enabled ? 1 : 0.6,
      }}
    >
      {/* Top row: name + cron chip + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--color-fg)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {schedule.name}
        </span>
        <span
          style={{
            fontSize: 11,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            padding: '1px 7px',
            borderRadius: 5,
            background: 'rgba(255,255,255,0.05)',
            color: '#ddd6fe',
            border: '1px solid rgba(167,139,250,0.18)',
            flexShrink: 0,
          }}
        >
          {schedule.cron}
        </span>
      </div>

      {/* Conversation + timing */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
          color: 'var(--color-muted, #a1a1aa)',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {conversationTitle}
        </span>
        <span style={{ flexShrink: 0 }}>
          {relativeTime(schedule.lastRun, 'ran')}
        </span>
        <span style={{ flexShrink: 0 }}>
          {relativeTime(schedule.nextRun, 'next in')}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        {/* Enabled toggle */}
        <button
          type="button"
          onClick={onToggle}
          title={schedule.enabled ? 'Disable' : 'Enable'}
          aria-label={schedule.enabled ? 'Disable schedule' : 'Enable schedule'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 6,
            background: schedule.enabled
              ? 'rgba(167,139,250,0.12)'
              : 'rgba(255,255,255,0.04)',
            border: `1px solid ${schedule.enabled ? 'rgba(167,139,250,0.22)' : 'rgba(255,255,255,0.08)'}`,
            color: schedule.enabled ? '#ddd6fe' : 'var(--color-muted)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {schedule.enabled ? 'On' : 'Off'}
        </button>

        <span style={{ flex: 1 }} />

        {/* Run now */}
        <ActionBtn onClick={onRunNow} title="Run now" ariaLabel="Run now">
          <Play className="size-3.5" />
        </ActionBtn>

        {/* Edit */}
        <ActionBtn onClick={onEdit} title="Edit" ariaLabel="Edit schedule">
          <Pencil className="size-3.5" />
        </ActionBtn>

        {/* Delete */}
        <ActionBtn onClick={onDelete} title="Delete" ariaLabel="Delete schedule" danger>
          <Trash2 className="size-3.5" />
        </ActionBtn>
      </div>
    </div>
  );
}

function ActionBtn({
  onClick,
  title,
  ariaLabel,
  danger,
  children,
}: {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        borderRadius: 6,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: danger ? '#f87171' : 'var(--color-fg-2)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ScheduleForm — inline create / edit form
// ---------------------------------------------------------------------------

type FormState = {
  name: string;
  cron: string;
  prompt: string;
  conversationId: string;
  enabled: boolean;
};

function ScheduleForm({
  initial,
  conversations,
  onSave,
  onCancel,
}: {
  initial?: Schedule;
  conversations: { id: string; title: string }[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    name: initial?.name ?? '',
    cron: initial?.cron ?? '',
    prompt: initial?.prompt ?? '',
    conversationId: initial?.conversationId ?? conversations[0]?.id ?? '',
    enabled: initial?.enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = initial ? `/v1/schedules/${initial.id}` : '/v1/schedules';
      const method = initial ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Server responded ${res.status}`);
      }
      onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    borderRadius: 7,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.10)',
    color: 'var(--color-fg)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: 'var(--color-muted)',
    marginBottom: 4,
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(167,139,250,0.18)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--color-fg)',
        }}
      >
        {initial ? 'Edit schedule' : 'New schedule'}
      </p>

      {/* Name */}
      <label>
        <span style={labelStyle}>Name</span>
        <input
          style={fieldStyle}
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Monday dashboard refresh"
          required
        />
      </label>

      {/* Cron */}
      <label>
        <span style={labelStyle}>Cron expression</span>
        <input
          style={fieldStyle}
          type="text"
          value={form.cron}
          onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
          placeholder="0 9 * * 1"
          required
        />
        <span
          style={{
            display: 'block',
            marginTop: 3,
            fontSize: 11,
            color: 'var(--color-muted)',
          }}
        >
          minute hour day month weekday
        </span>
      </label>

      {/* Prompt */}
      <label>
        <span style={labelStyle}>Prompt</span>
        <textarea
          style={{ ...fieldStyle, resize: 'vertical', minHeight: 64 }}
          value={form.prompt}
          onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
          placeholder="Refresh the Q3 dashboard with latest data"
          rows={3}
          required
        />
      </label>

      {/* Target conversation */}
      <label>
        <span style={labelStyle}>Target conversation</span>
        <select
          style={fieldStyle}
          value={form.conversationId}
          onChange={(e) => setForm((f) => ({ ...f, conversationId: e.target.value }))}
          required
        >
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>

      {/* Enabled */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: 'var(--color-fg-2)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
        />
        Enabled
      </label>

      {/* Error */}
      {error && (
        <p style={{ margin: 0, fontSize: 12, color: '#f87171' }}>{error}</p>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '4px 14px',
            borderRadius: 7,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.10)',
            color: 'var(--color-muted)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '4px 14px',
            borderRadius: 7,
            background: 'rgba(167,139,250,0.15)',
            border: '1px solid rgba(167,139,250,0.30)',
            color: '#ddd6fe',
            fontSize: 12,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
