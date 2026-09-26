import { capitalize, collapse, tidy } from './common';

export type StopwatchData = { label: string };

export function parseStopwatch(text: string): StopwatchData {
  const rest = collapse(text)
    .toLowerCase()
    .replace(/\b(start|a|the|new|stopwatch|lap timer|timer|for|my)\b/g, ' ');
  return { label: capitalize(tidy(rest)) };
}
