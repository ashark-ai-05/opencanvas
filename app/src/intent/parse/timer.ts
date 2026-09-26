import { capitalize, collapse, tidy } from './common';

export type TimerData = {
  /** null when no valid duration (1 s … 24 h) was found. */
  seconds: number | null;
  label: string;
  pomodoro: boolean;
};

export const MAX_TIMER_SEC = 24 * 3600;

const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

export function parseTimer(text: string): TimerData {
  let rest = ` ${collapse(text).toLowerCase()} `;
  let seconds = 0;
  let found = false;
  const pomodoro = /\bpomodoro\b/.test(rest);

  const special: [RegExp, number][] = [
    [/\bhalf an? hour\b/, 30 * 60],
    [/\ban? hour\b/, 60 * 60],
    [/\ba minute\b/, 60],
  ];
  for (const [re, s] of special) {
    if (re.test(rest)) {
      seconds += s;
      found = true;
      rest = rest.replace(re, ' ');
    }
  }

  rest = rest.replace(
    /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g,
    (_, n: string, u: string) => {
      seconds += Number(n) * UNIT[u[0]];
      found = true;
      return ' ';
    },
  );

  rest = rest.replace(/\b(\d{1,2}):(\d{2})\b/, (_, m: string, s: string) => {
    seconds += Number(m) * 60 + Number(s);
    found = true;
    return ' ';
  });

  const label = capitalize(
    tidy(rest.replace(/\b(?:timer|set|start|a|for|countdown|of|pomodoro)\b/g, ' ')),
  );

  const rounded = Math.round(seconds);
  const valid = found && rounded >= 1 && rounded <= MAX_TIMER_SEC;
  return { seconds: valid ? rounded : null, label, pomodoro };
}
