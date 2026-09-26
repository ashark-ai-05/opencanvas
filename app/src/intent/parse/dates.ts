import * as chrono from 'chrono-node';

export type DateHit = {
  date: Date;
  hasTime: boolean;
  /** The matched substring for the primary (date) span, kept for backward compat. */
  text: string;
  index: number;
  /** Every chrono match folded into this hit — used to strip all of them from the text. */
  spans: Array<{ index: number; text: string }>;
};

/**
 * First date in `text`, always resolved forward from `ref`. When the day
 * comes before the time ("monday standup 10am"), chrono returns them as two
 * separate results — the first (the day) not certain on the hour, the
 * second (the time) certain on it. Merge the second's hour/minute into the
 * first's date so a day-first phrase doesn't lose its time.
 */
export function firstDate(text: string, ref: Date): DateHit | null {
  const results = chrono.parse(text, ref, { forwardDate: true });
  const r = results[0];
  if (!r) return null;
  let date = r.start.date();
  let hasTime = r.start.isCertain('hour');
  const spans: Array<{ index: number; text: string }> = [{ index: r.index, text: r.text }];

  if (!hasTime) {
    const second = results[1];
    if (second && second.start.isCertain('hour')) {
      const timeDate = second.start.date();
      const merged = new Date(date);
      merged.setHours(timeDate.getHours(), timeDate.getMinutes(), timeDate.getSeconds(), 0);
      date = merged;
      hasTime = true;
      spans.push({ index: second.index, text: second.text });
    }
  }

  return { date, hasTime, text: r.text, index: r.index, spans };
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

/** Remove every matched date/time span from `text`, highest index first. */
export function withoutDate(text: string, hit: DateHit): string {
  let out = text;
  const spans = [...hit.spans].sort((a, b) => b.index - a.index);
  for (const s of spans) {
    out = out.slice(0, s.index) + ' ' + out.slice(s.index + s.text.length);
  }
  return out;
}
