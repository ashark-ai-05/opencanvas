/** Lower-case place / abbreviation → IANA zone. Extend freely. */
export const ZONES: Record<string, string> = {
  utc: 'UTC',
  gmt: 'UTC',
  london: 'Europe/London',
  bst: 'Europe/London',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  cet: 'Europe/Berlin',
  madrid: 'Europe/Madrid',
  rome: 'Europe/Rome',
  amsterdam: 'Europe/Amsterdam',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  est: 'America/New_York',
  edt: 'America/New_York',
  toronto: 'America/Toronto',
  chicago: 'America/Chicago',
  cst: 'America/Chicago',
  denver: 'America/Denver',
  mst: 'America/Denver',
  'los angeles': 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  sf: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  'sao paulo': 'America/Sao_Paulo',
  dubai: 'Asia/Dubai',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  bengaluru: 'Asia/Kolkata',
  ist: 'Asia/Kolkata',
  singapore: 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  shanghai: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai',
  seoul: 'Asia/Seoul',
  tokyo: 'Asia/Tokyo',
  jst: 'Asia/Tokyo',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  aest: 'Australia/Sydney',
  auckland: 'Pacific/Auckland',
};

const KEYS = Object.keys(ZONES).sort((a, b) => b.length - a.length);
const ZONE_RE = new RegExp(`\\b(${KEYS.join('|')})\\b`, 'i');

/** First (longest) zone word in `text`, or null. */
export function findZone(text: string): { key: string; tz: string } | null {
  const m = text.toLowerCase().match(ZONE_RE);
  if (!m) return null;
  const key = m[1].toLowerCase();
  return { key, tz: ZONES[key] };
}
