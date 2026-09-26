import type { WidgetKind } from '../../../src/agent/types';
import type { CardIntent } from './types';
import { formatDuration, formatNumber, titleCase } from './parse/common';
import { parseTimer, type TimerData } from './parse/timer';
import { parseStopwatch, type StopwatchData } from './parse/stopwatch';
import { parseClock, type ClockData } from './parse/clock';
import { parseTodo, type TodoData } from './parse/todo';
import { parseReminder, type ReminderData } from './parse/reminder';
import { parseEvent, type EventData } from './parse/event';
import { parseNote, type NoteData } from './parse/note';
import { parseCalc, type CalcData } from './parse/calc';
import { parseConvert, unitLabel, type ConvertData } from './parse/convert';

/** Icon names are resolved to lucide components by the chip, not here. */
export type IconName =
  | 'timer'
  | 'stopwatch'
  | 'clock'
  | 'list'
  | 'bell'
  | 'calendar'
  | 'note'
  | 'calculator'
  | 'ruler';

export type IntentEntry<D = unknown> = {
  key: CardIntent;
  kind: WidgetKind;
  label: string;
  icon: IconName;
  parse: (text: string, ref: Date) => D;
  complete: (d: D) => boolean;
  summary: (d: D) => string;
  /** Only called when complete(d) is true. */
  toPayload: (d: D) => Record<string, unknown>;
};

const strip = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

const timer: IntentEntry<TimerData> = {
  key: 'timer',
  kind: 'time',
  label: 'Timer',
  icon: 'timer',
  parse: (t) => parseTimer(t),
  complete: (d) => d.pomodoro || d.seconds != null,
  summary: (d) =>
    d.pomodoro
      ? `Pomodoro 25/5${d.label ? ` · ${d.label}` : ''}`
      : `Timer ${formatDuration(d.seconds ?? 0)}${d.label ? ` · ${d.label}` : ''}`,
  toPayload: (d) =>
    d.pomodoro
      ? strip({ mode: 'pomodoro', pomodoro: { workSec: 1500, breakSec: 300 }, label: d.label })
      : strip({ mode: 'timer', durationSec: d.seconds ?? 0, label: d.label }),
};

const stopwatch: IntentEntry<StopwatchData> = {
  key: 'stopwatch',
  kind: 'time',
  label: 'Stopwatch',
  icon: 'stopwatch',
  parse: (t) => parseStopwatch(t),
  complete: () => true,
  summary: (d) => `Stopwatch${d.label ? ` · ${d.label}` : ''}`,
  toPayload: (d) => strip({ mode: 'stopwatch', label: d.label }),
};

const clock: IntentEntry<ClockData> = {
  key: 'clock',
  kind: 'time',
  label: 'Clock',
  icon: 'clock',
  parse: (t) => parseClock(t),
  complete: () => true,
  summary: (d) => `Clock${d.place ? ` · ${d.place}` : ' · Local'}`,
  toPayload: (d) =>
    strip({ mode: 'clock', tz: d.tz ?? undefined, format: d.format ?? undefined, label: d.place ?? undefined }),
};

const todo: IntentEntry<TodoData> = {
  key: 'todo',
  kind: 'tasks',
  label: 'Checklist',
  icon: 'list',
  parse: (t) => parseTodo(t),
  complete: (d) => d.items.length >= 2 || (d.explicit && d.items.length >= 1),
  summary: (d) => `${d.title} · ${d.items.length} item${d.items.length === 1 ? '' : 's'}`,
  toPayload: (d) => ({ title: d.title, items: d.items.map((text) => ({ text })) }),
};

const reminder: IntentEntry<ReminderData> = {
  key: 'reminder',
  kind: 'tasks',
  label: 'Reminder',
  icon: 'bell',
  parse: (t, ref) => parseReminder(t, ref),
  complete: (d) => d.task.length > 0,
  summary: (d) => `Reminder · ${d.task}${d.due ? ` · ${d.due}${d.time ? ` ${d.time}` : ''}` : ''}`,
  toPayload: (d) => ({
    title: 'Reminder',
    items: [strip({ text: d.task, due: d.due ? (d.time ? `${d.due} ${d.time}` : d.due) : undefined })],
  }),
};

const event: IntentEntry<EventData> = {
  key: 'event',
  kind: 'key-value-card',
  label: 'Event',
  icon: 'calendar',
  parse: (t, ref) => parseEvent(t, ref),
  complete: (d) => d.date != null,
  summary: (d) => `Event · ${d.title}${d.when ? ` · ${d.when}` : ''}`,
  toPayload: (d) => {
    const fields: { key: string; value: string }[] = [];
    if (d.when) fields.push({ key: 'When', value: d.when });
    if (d.attendees.length) fields.push({ key: 'With', value: d.attendees.join(', ') });
    if (d.mode) fields.push({ key: 'Mode', value: titleCase(d.mode) });
    if (d.place) fields.push({ key: 'Where', value: d.place });
    const title = d.attendees.length ? `${d.title} with ${d.attendees.join(', ')}` : d.title;
    return { title, fields };
  },
};

const note: IntentEntry<NoteData> = {
  key: 'note',
  kind: 'sticky-note',
  label: 'Note',
  icon: 'note',
  parse: (t) => parseNote(t),
  complete: (d) => d.explicit && d.body.length > 0,
  summary: (d) => `Note · ${d.body.length > 40 ? `${d.body.slice(0, 40)}…` : d.body}`,
  toPayload: (d) => ({ body: d.body }),
};

const calc: IntentEntry<CalcData> = {
  key: 'calc',
  kind: 'key-value-card',
  label: 'Calc',
  icon: 'calculator',
  parse: (t) => parseCalc(t),
  complete: (d) => d.result != null,
  summary: (d) =>
    d.each != null
      ? `${d.expression} = ${formatNumber(d.each)} each`
      : `${d.expression} = ${formatNumber(d.result ?? 0)}`,
  toPayload: (d) => ({
    title: d.expression,
    fields: [
      { key: 'Result', value: formatNumber(d.result ?? 0) },
      ...(d.each != null ? [{ key: 'Each', value: formatNumber(d.each) }] : []),
    ],
  }),
};

const convert: IntentEntry<ConvertData | null> = {
  key: 'convert',
  kind: 'key-value-card',
  label: 'Convert',
  icon: 'ruler',
  parse: (t) => parseConvert(t),
  complete: (d) => d != null && d.result != null,
  summary: (d) => (d ? `${d.expression} = ${formatNumber(d.result ?? 0)} ${unitLabel(d.to)}` : 'Convert'),
  toPayload: (d) => ({
    title: d!.expression,
    fields: [{ key: 'Result', value: `${formatNumber(d!.result ?? 0)} ${unitLabel(d!.to)}` }],
  }),
};

export const INTENTS: Record<CardIntent, IntentEntry<any>> = {
  timer,
  stopwatch,
  clock,
  todo,
  reminder,
  event,
  note,
  calc,
  convert,
};

export type Resolved = {
  entry: IntentEntry<any>;
  data: unknown;
  complete: boolean;
  summary: string;
  payload: Record<string, unknown> | null;
};

export function resolve(intent: CardIntent, text: string, ref: Date): Resolved {
  const entry = INTENTS[intent];
  const data = entry.parse(text.trim(), ref);
  const complete = entry.complete(data);
  return {
    entry,
    data,
    complete,
    summary: entry.summary(data),
    payload: complete ? entry.toPayload(data) : null,
  };
}
