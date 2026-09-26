import { collapse, titleCase } from './common';
import { findZone } from '../zones';

export type ClockData = {
  tz: string | null;
  place: string | null;
  format: '12h' | '24h' | null;
};

export function parseClock(text: string): ClockData {
  const t = collapse(text).toLowerCase();
  const zone = findZone(t);
  const format = /\b(24h|24-hour|military)\b/.test(t)
    ? '24h'
    : /\b(12h|12-hour)\b/.test(t)
      ? '12h'
      : null;
  return {
    tz: zone?.tz ?? null,
    place: zone ? titleCase(zone.key) : null,
    format,
  };
}
