import { capitalize, collapse, tidy, titleCase } from './common';
import { firstDate, hhmm, humanWhen, isoDate, withoutDate } from './dates';

export type EventData = {
  title: string;
  date: string | null;
  time: string | null;
  /** Human "Sun 27 Sep, 10:00" for display. */
  when: string | null;
  attendees: string[];
  mode: 'video' | 'phone' | null;
  place: string | null;
};

const VIDEO = /\b(zoom|google meet|meet|teams|facetime|video call|video)\b/i;
const PHONE = /\b(phone|call)\b/i;
const MODE_PHRASE = /\b(?:on|via|over)\s+(?:zoom|google meet|meet|teams|facetime|video call|video|phone)\b/gi;
const WITH = /\bwith\s+([A-Za-z]+(?:(?:,\s*|\s+and\s+|\s*&\s*)[A-Za-z]+)*)/i;
const PLACE = /\b(?:at|in)\s+(?:the\s+)?([A-Za-z][A-Za-z' ]{1,30})$/i;

export function parseEvent(text: string, ref: Date): EventData {
  let t = collapse(text);
  const hit = firstDate(t, ref);
  if (hit) t = withoutDate(t, hit);

  let mode: EventData['mode'] = null;
  if (VIDEO.test(t)) mode = 'video';
  else if (PHONE.test(t)) mode = 'phone';
  t = t.replace(MODE_PHRASE, ' ');

  const attendees: string[] = [];
  const wm = t.match(WITH);
  if (wm) {
    attendees.push(...wm[1].split(/,\s*|\s+and\s+|\s*&\s*/i).map(capitalize));
    t = t.replace(wm[0], ' ');
  }

  let place: string | null = null;
  const pm = collapse(t).match(PLACE);
  if (pm) {
    place = titleCase(pm[1].trim());
    t = collapse(t).slice(0, pm.index);
  }

  const title = titleCase(tidy(t)) || 'Event';
  return {
    title,
    date: hit ? isoDate(hit.date) : null,
    time: hit?.hasTime ? hhmm(hit.date) : null,
    when: hit ? humanWhen(hit.date, hit.hasTime) : null,
    attendees,
    mode,
    place,
  };
}
