import { capitalize, collapse, tidy } from './common';
import { firstDate, hhmm, isoDate, withoutDate } from './dates';

export type ReminderData = {
  task: string;
  /** YYYY-MM-DD local, or null. */
  due: string | null;
  /** HH:mm local when the text named a time. */
  time: string | null;
};

// Not anchored to the start: a day-first reminder ("friday remind me to pay
// rent 6pm") has the trigger phrase in the middle of the text.
const TRIGGER =
  /(?:remind me (?:to|about|of)?|reminder\s*:?|don'?t forget (?:to)?|remember (?:to)?)\s*/i;

export function parseReminder(text: string, ref: Date): ReminderData {
  let t = collapse(text).replace(TRIGGER, '');
  const hit = firstDate(t, ref);
  if (hit) t = withoutDate(t, hit);
  return {
    task: capitalize(tidy(t)),
    due: hit ? isoDate(hit.date) : null,
    time: hit?.hasTime ? hhmm(hit.date) : null,
  };
}
