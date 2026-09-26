import { collapse, formatNumber, toNumber } from './common';

export type CalcData = {
  expression: string;
  result: number | null;
  people: number | null;
  each: number | null;
};

const EMPTY = (expression: string): CalcData => ({
  expression,
  result: null,
  people: null,
  each: null,
});

const SPLIT =
  /\bsplit\s+([\d,]+(?:\.\d+)?)\s*(?:between|among|across|by|\/)\s*(\d+)(?:\s*(?:people|ways|persons|friends))?/i;
const PERCENT = /(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?([\d,]+(?:\.\d+)?)/i;

/**
 * Tiny recursive-descent evaluator for + - * / ( ) and unary minus.
 * Returns null on any syntax error. Never uses eval.
 */
export function evaluate(expr: string): number | null {
  const s = expr.replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  const next = () => s[i++];

  function number(): number | null {
    const m = s.slice(i).match(/^\d+(?:\.\d+)?/);
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  }
  function factor(): number | null {
    if (peek() === '(') {
      next();
      const v = sum();
      if (peek() !== ')') return null;
      next();
      return v;
    }
    if (peek() === '-') {
      next();
      const v = factor();
      return v === null ? null : -v;
    }
    return number();
  }
  function product(): number | null {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = next();
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function sum(): number | null {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = next();
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  return i === s.length && v !== null && Number.isFinite(v) ? v : null;
}

export function parseCalc(text: string): CalcData {
  const t = collapse(text)
    .toLowerCase()
    .replace(/^(?:what(?:'s| is)|calc(?:ulate)?|compute|how much is)\s+/, '')
    .replace(/[?=]+\s*$/, '')
    .trim();

  const s = t.match(SPLIT);
  if (s) {
    const amount = toNumber(s[1]);
    const people = Number(s[2]);
    if (people > 0) {
      return {
        expression: `${formatNumber(amount)} ÷ ${people}`,
        result: amount,
        people,
        each: amount / people,
      };
    }
  }

  const p = t.match(PERCENT);
  if (p) {
    const pct = Number(p[1]);
    const base = toNumber(p[2]);
    return {
      expression: `${pct}% of ${formatNumber(base)}`,
      result: (pct / 100) * base,
      people: null,
      each: null,
    };
  }

  const expr = t
    .replace(/(\d)\s*[x×]\s*(\d)/g, '$1*$2')
    .replace(/÷/g, '/')
    .replace(/,/g, '');
  if (!/^[\d\s+\-*/().]+$/.test(expr) || !/[+\-*/]/.test(expr) || !/\d/.test(expr)) {
    return EMPTY(t);
  }
  const result = evaluate(expr);
  return result === null ? EMPTY(t) : { expression: collapse(t), result, people: null, each: null };
}
