import { capitalize, collapse } from './common';

export type NoteData = { body: string; explicit: boolean };

const PREFIX = /^(?:note|idea|thought|memo|remember)\s*:\s*/i;

export function parseNote(text: string): NoteData {
  const t = collapse(text);
  const m = t.match(PREFIX);
  if (!m) return { body: t, explicit: false };
  return { body: capitalize(t.slice(m[0].length)), explicit: true };
}
