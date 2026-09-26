import * as chrono from 'chrono-node';

export type DateHit = {
  date: Date;
  hasTime: boolean;
  /** The matched substring, so callers can remove it. */
  text: string;
  index: number;
};

/** First date in `text`, always resolved forward from `ref`. */
export function firstDate(text: string, ref: Date): DateHit | null {
  const results = chrono.parse(text, ref, { forwardDate: true });
  const r = results[0];
  if (!r) return null;
  return {
    date: r.start.date(),
    hasTime: r.start.isCertain('hour'),
    text: r.text,
    index: r.index,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD (not UTC — a 10pm local event must not roll to tomorrow). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sun 27 Sep, 10:00" or "Fri 2 Oct". */
export function humanWhen(d: Date, hasTime: boolean): string {
  const base = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return hasTime ? `${base}, ${hhmm(d)}` : base;
}

/** Remove the matched date text from `text`. */
export function withoutDate(text: string, hit: DateHit): string {
  return text.slice(0, hit.index) + ' ' + text.slice(hit.index + hit.text.length);
}
