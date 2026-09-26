export const capitalize = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export const titleCase = (s: string): string =>
  s.split(/\s+/).filter(Boolean).map(capitalize).join(' ');

export const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Strip dangling connector words left behind after removing a phrase. */
export function tidy(s: string): string {
  let out = collapse(s.replace(/[,;]+\s*$/g, '').replace(/^\s*[,;:-]+/g, ''));
  const dangling =
    /\s+(on|at|by|for|with|to|in|and|the|this|next|from|every|a|an)$/i;
  const leading = /^(on|at|by|for|and|the|to|a|an)\s+/i;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(dangling, '').replace(leading, '');
    if (next === out) break;
    out = next;
  }
  // A lone connector word ("on", "the") is nothing.
  if (/^(on|at|by|for|with|to|in|and|the|a|an)$/i.test(out)) return '';
  return out.trim();
}

export function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

/** 1500 → "25:00", 3661 → "1:01:01". */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
