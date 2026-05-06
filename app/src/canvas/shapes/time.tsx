import type { SourcePill } from './shared';
import { useEffect, useState } from 'react';
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { resizeBox } from 'tldraw';
import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react';
import { CardActions, CardFrame, CardHeader, CardTitle, Tag } from './shared';
import { getEditor } from '../../state/editor-ref';

/**
 * Live time widget — handles four modes (clock / timer / stopwatch /
 * pomodoro) in one shape. The agent places initial state via
 * place_widget; the user drives play/pause/reset via the shape's own
 * buttons.
 *
 * Tick: a single setInterval(1s) inside the component reads
 * Date.now() each frame; we never store the running elapsed value
 * back into shape props so the canvas isn't re-saving every second.
 * The only writes are user-driven transitions (start/pause/reset/
 * skip) and pomodoro auto-cycles.
 *
 * Reload semantics: epoch-ms `startedAt` + `elapsedAtPause` survive
 * a reload, so a 25-min timer started an hour ago opens already-
 * fired. No persistence work — tldraw saves the shape props.
 */
export type TimeMode = 'clock' | 'timer' | 'stopwatch' | 'pomodoro';
export type PomodoroPhase = 'work' | 'break' | 'longBreak';

type Pomodoro = {
  workSec: number;
  breakSec: number;
  longBreakSec?: number;
  longBreakEvery?: number;
  sessions?: number;
  phase?: PomodoroPhase;
};

/**
 * `mode` and `format` are stored as `string` because tldraw's runtime
 * validator (T.string) doesn't preserve the literal union — narrowing
 * happens at render time. Same pattern as `align` on table.tsx.
 */
export type TimeShape = TLBaseShape<
  'opencanvas:time',
  {
    w: number;
    h: number;
    mode: string;
    label?: string;
    tz?: string;
    format?: string;
    durationSec?: number;
    startedAt?: number;
    elapsedAtPause?: number;
    paused?: boolean;
    pomodoro?: Pomodoro;
    source?: string;
    sources?: SourcePill[];
  }
>;

export class TimeShapeUtil extends ShapeUtil<TimeShape> {
  static override type = 'opencanvas:time' as const;

  static override props: RecordProps<TimeShape> = {
    w: T.number,
    h: T.number,
    mode: T.string,
    label: T.optional(T.string),
    tz: T.optional(T.string),
    format: T.optional(T.string),
    durationSec: T.optional(T.number),
    startedAt: T.optional(T.number),
    elapsedAtPause: T.optional(T.number),
    paused: T.optional(T.boolean),
    pomodoro: T.optional(T.any),
    source: T.optional(T.string),
    sources: T.optional(T.any),
  };

  override getDefaultProps(): TimeShape['props'] {
    return { w: 240, h: 160, mode: 'clock' };
  }

  override getGeometry(shape: TimeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TimeShape) {
    return <TimeBody shape={shape} />;
  }

  override indicator(shape: TimeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onResize(shape: TimeShape, info: Parameters<typeof resizeBox>[1]) {
    return resizeBox(shape, info);
  }

  override canResize() {
    return true;
  }
}

function TimeBody({ shape }: { shape: TimeShape }) {
  // Tick at 1Hz so wall-clock + elapsed counters refresh every second.
  // We don't write the tick back to props — the elapsed value is
  // computed from props.startedAt + Date.now() each render.
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const mode: TimeMode = (shape.props.mode as TimeMode) ?? 'clock';
  return (
    <HTMLContainer>
      <CardFrame shape={shape}>
        <CardHeader>
          <CardTitle>{shape.props.label ?? defaultLabel(mode)}</CardTitle>
          <Tag>{mode}</Tag>
          <CardActions shape={shape} />
        </CardHeader>
        <div className="opencanvas-card-body opencanvas-time-body">
          {mode === 'clock' && <ClockMode shape={shape} />}
          {mode === 'timer' && <TimerMode shape={shape} />}
          {mode === 'stopwatch' && <StopwatchMode shape={shape} />}
          {mode === 'pomodoro' && <PomodoroMode shape={shape} />}
        </div>
      </CardFrame>
    </HTMLContainer>
  );
}

function defaultLabel(mode: TimeMode): string {
  if (mode === 'clock') return 'Clock';
  if (mode === 'timer') return 'Timer';
  if (mode === 'stopwatch') return 'Stopwatch';
  return 'Pomodoro';
}

/* ──────────────────────────────────────────────────────────────────
 * Clock mode — wall clock in IANA tz, 12h/24h format.
 * ──────────────────────────────────────────────────────────────────*/
function ClockMode({ shape }: { shape: TimeShape }) {
  // format prop is stored as `string` for tldraw's validator; narrow here.
  const fmt: '12h' | '24h' = shape.props.format === '12h' ? '12h' : '24h';
  const tz = shape.props.tz;
  const now = new Date();
  const time = formatClock(now, tz, fmt);
  const date = formatDate(now, tz);
  return (
    <div className="opencanvas-time-display">
      <div className="opencanvas-time-numerals">{time}</div>
      <div className="opencanvas-time-meta">
        {date}
        {tz && <span className="opencanvas-time-tz"> · {tz}</span>}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Timer mode — counts DOWN from durationSec.
 * ──────────────────────────────────────────────────────────────────*/
function TimerMode({ shape }: { shape: TimeShape }) {
  const { durationSec = 0 } = shape.props;
  const elapsed = computeElapsedSec(shape.props);
  const remaining = Math.max(0, durationSec - elapsed);
  const done = remaining <= 0 && (shape.props.startedAt !== undefined || shape.props.elapsedAtPause !== undefined);
  const pct = durationSec > 0 ? Math.min(100, (elapsed / durationSec) * 100) : 0;

  return (
    <div className="opencanvas-time-display">
      <div
        className={
          'opencanvas-time-numerals' + (done ? ' opencanvas-time-done' : '')
        }
      >
        {formatHMS(remaining)}
      </div>
      <div className="opencanvas-time-progress">
        <div
          className="opencanvas-time-progress-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <TimeControls shape={shape} canSkip={false} resetTo={{ startedAt: undefined, elapsedAtPause: 0, paused: false }} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Stopwatch mode — counts UP indefinitely.
 * ──────────────────────────────────────────────────────────────────*/
function StopwatchMode({ shape }: { shape: TimeShape }) {
  const elapsed = computeElapsedSec(shape.props);
  return (
    <div className="opencanvas-time-display">
      <div className="opencanvas-time-numerals">{formatHMS(elapsed)}</div>
      <TimeControls shape={shape} canSkip={false} resetTo={{ startedAt: undefined, elapsedAtPause: 0, paused: false }} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Pomodoro — alternates work/break, tracks completed sessions, takes
 * a long break every `longBreakEvery` work sessions.
 * ──────────────────────────────────────────────────────────────────*/
function PomodoroMode({ shape }: { shape: TimeShape }) {
  const pomo = shape.props.pomodoro;
  if (!pomo) {
    return (
      <div className="opencanvas-time-display">
        <div className="opencanvas-time-meta">Missing pomodoro config.</div>
      </div>
    );
  }
  const phase: PomodoroPhase = pomo.phase ?? 'work';
  const sessions = pomo.sessions ?? 0;
  const longEvery = pomo.longBreakEvery ?? 4;
  const longSec = pomo.longBreakSec ?? pomo.breakSec * 2;
  const phaseDuration =
    phase === 'work'
      ? pomo.workSec
      : phase === 'longBreak'
        ? longSec
        : pomo.breakSec;

  const elapsed = computeElapsedSec(shape.props);
  const remaining = Math.max(0, phaseDuration - elapsed);
  const pct = phaseDuration > 0 ? Math.min(100, (elapsed / phaseDuration) * 100) : 0;

  // Auto-advance: when the phase elapses AND we're actively running,
  // flip to the next phase. We do this in a useEffect so the writes
  // happen post-render (avoid setState-during-render warnings).
  useEffect(() => {
    if (remaining > 0) return;
    if (shape.props.paused) return;
    if (shape.props.startedAt === undefined && (shape.props.elapsedAtPause ?? 0) === 0) return;
    const editor = getEditor();
    if (!editor) return;
    const nextSessions = phase === 'work' ? sessions + 1 : sessions;
    const nextPhase: PomodoroPhase =
      phase === 'work'
        ? nextSessions % longEvery === 0
          ? 'longBreak'
          : 'break'
        : 'work';
    editor.updateShape({
      id: shape.id as never,
      type: shape.type as never,
      props: {
        startedAt: Date.now(),
        elapsedAtPause: 0,
        paused: false,
        pomodoro: { ...pomo, phase: nextPhase, sessions: nextSessions },
      } as never,
    } as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, phase]);

  return (
    <div className="opencanvas-time-display">
      <div className="opencanvas-time-pomo-phase" data-phase={phase}>
        {phase === 'work' ? 'focus' : phase === 'break' ? 'break' : 'long break'}
      </div>
      <div className="opencanvas-time-numerals">{formatHMS(remaining)}</div>
      <div className="opencanvas-time-progress" data-phase={phase}>
        <div
          className="opencanvas-time-progress-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="opencanvas-time-pomo-sessions">
        sessions: <strong>{sessions}</strong>
      </div>
      <TimeControls
        shape={shape}
        canSkip
        resetTo={{
          startedAt: undefined,
          elapsedAtPause: 0,
          paused: false,
          pomodoro: { ...pomo, phase: 'work', sessions: 0 },
        }}
        onSkip={() => {
          const editor = getEditor();
          if (!editor) return;
          const nextSessions = phase === 'work' ? sessions + 1 : sessions;
          const nextPhase: PomodoroPhase =
            phase === 'work'
              ? nextSessions % longEvery === 0
                ? 'longBreak'
                : 'break'
              : 'work';
          editor.updateShape({
            id: shape.id as never,
            type: shape.type as never,
            props: {
              startedAt: Date.now(),
              elapsedAtPause: 0,
              paused: false,
              pomodoro: { ...pomo, phase: nextPhase, sessions: nextSessions },
            } as never,
          } as never);
        }}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Shared play/pause/reset/skip controls for timer/stopwatch/pomodoro.
 * Stops pointer/click events from bubbling up to tldraw's drag handlers
 * so a click on a control doesn't pick up the shape.
 * ──────────────────────────────────────────────────────────────────*/
function TimeControls({
  shape,
  canSkip,
  resetTo,
  onSkip,
}: {
  shape: TimeShape;
  canSkip: boolean;
  resetTo: Record<string, unknown>;
  onSkip?: () => void;
}) {
  const running = shape.props.startedAt !== undefined && !shape.props.paused;

  const stopProp = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
  };

  const togglePlay = () => {
    const editor = getEditor();
    if (!editor) return;
    if (running) {
      // Pause: freeze accumulated elapsed.
      const accumulated = computeElapsedSec(shape.props);
      editor.updateShape({
        id: shape.id as never,
        type: shape.type as never,
        props: {
          startedAt: undefined,
          elapsedAtPause: accumulated,
          paused: true,
        } as never,
      } as never);
    } else {
      // Resume: start a new run; preserve elapsedAtPause as the prior total.
      editor.updateShape({
        id: shape.id as never,
        type: shape.type as never,
        props: {
          startedAt: Date.now(),
          elapsedAtPause: shape.props.elapsedAtPause ?? 0,
          paused: false,
        } as never,
      } as never);
    }
  };

  const reset = () => {
    const editor = getEditor();
    if (!editor) return;
    editor.updateShape({
      id: shape.id as never,
      type: shape.type as never,
      props: resetTo as never,
    } as never);
  };

  return (
    <div
      className="opencanvas-time-controls"
      onMouseDown={stopProp}
      onPointerDown={stopProp}
      onClick={stopProp}
    >
      <button
        type="button"
        className="opencanvas-time-btn opencanvas-time-btn--primary"
        onClick={togglePlay}
        title={running ? 'Pause' : 'Start'}
      >
        {running ? <Pause className="size-3" /> : <Play className="size-3" />}
      </button>
      <button
        type="button"
        className="opencanvas-time-btn"
        onClick={reset}
        title="Reset"
      >
        <RotateCcw className="size-3" />
      </button>
      {canSkip && onSkip && (
        <button
          type="button"
          className="opencanvas-time-btn"
          onClick={onSkip}
          title="Skip phase"
        >
          <SkipForward className="size-3" />
        </button>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────*/

/**
 * Compute the running elapsed seconds for a timer/stopwatch/pomodoro
 * shape. When paused, returns the frozen elapsedAtPause. When running,
 * returns elapsedAtPause + (now - startedAt). When neither is set,
 * returns 0.
 */
export function computeElapsedSec(props: {
  startedAt?: number;
  elapsedAtPause?: number;
  paused?: boolean;
}): number {
  const base = props.elapsedAtPause ?? 0;
  if (props.paused) return base;
  if (props.startedAt === undefined) return base;
  return base + Math.max(0, (Date.now() - props.startedAt) / 1000);
}

/**
 * Format a number of seconds as HH:MM:SS (drops the hours segment
 * when the duration is under an hour). Floors fractional seconds
 * down so a 1500-second timer reads "25:00" at start.
 */
export function formatHMS(totalSec: number): string {
  const t = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatClock(d: Date, tz: string | undefined, fmt: '12h' | '24h'): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: fmt === '12h',
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toLocaleTimeString();
  }
}

function formatDate(d: Date, tz: string | undefined): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toDateString();
  }
}
