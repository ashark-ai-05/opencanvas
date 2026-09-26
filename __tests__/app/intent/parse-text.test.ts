import { describe, it, expect } from 'vitest';
import { parseTodo } from '../../../app/src/intent/parse/todo';
import { parseNote } from '../../../app/src/intent/parse/note';
import { parseCalc, evaluate } from '../../../app/src/intent/parse/calc';
import { parseConvert } from '../../../app/src/intent/parse/convert';

describe('parseTodo', () => {
  it('splits on commas and "and", strips a leading verb', () => {
    const d = parseTodo('buy milk, eggs, bread and coffee');
    expect(d.items).toEqual(['Milk', 'Eggs', 'Bread', 'Coffee']);
    expect(d.verb).toBe('buy');
    expect(d.title).toBe('Shopping list');
    expect(d.explicit).toBe(true);
  });
  it('explicit prefix with semicolons', () => {
    const d = parseTodo('todo: call bank; renew passport');
    expect(d.items).toEqual(['Call bank', 'Renew passport']);
    expect(d.title).toBe('Checklist');
    expect(d.explicit).toBe(true);
  });
  it('keeps unicode items intact (review focus 3)', () => {
    expect(parseTodo('buy 🥛 milk, 🥚 eggs').items).toEqual(['🥛 milk', '🥚 eggs']);
  });
  it('a plain sentence is not explicit', () => {
    expect(parseTodo('explain this code').explicit).toBe(false);
  });
});

describe('parseNote', () => {
  it('requires a prefix', () => {
    expect(parseNote('note: the api key rotates monthly')).toEqual({
      body: 'The api key rotates monthly',
      explicit: true,
    });
    expect(parseNote('idea: canvas templates')).toEqual({ body: 'Canvas templates', explicit: true });
    expect(parseNote('the api key rotates monthly').explicit).toBe(false);
  });
});

describe('calc', () => {
  it('evaluate handles precedence, parens, unary minus', () => {
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('(2+3)*4')).toBe(20);
    expect(evaluate('-3+5')).toBe(2);
    expect(evaluate('10/4')).toBe(2.5);
    expect(evaluate('2+')).toBeNull();
    expect(evaluate('abc')).toBeNull();
  });
  it('percent of', () => {
    const d = parseCalc('18% of 3450');
    expect(d.result).toBeCloseTo(621);
    expect(d.expression).toBe('18% of 3,450');
  });
  it('split between', () => {
    const d = parseCalc('split 2400 between 3');
    expect(d.people).toBe(3);
    expect(d.each).toBe(800);
  });
  it('plain arithmetic with a question prefix', () => {
    expect(parseCalc('what is 2400 / 3?').result).toBe(800);
    expect(parseCalc('12 x 12').result).toBe(144);
  });
  it('prose is not calc', () => {
    expect(parseCalc('summarise the 3 docs').result).toBeNull();
  });
});

describe('parseConvert', () => {
  it('length', () => {
    const d = parseConvert('5 miles in km')!;
    expect(d.result).toBeCloseTo(8.047, 3);
    expect(d.from).toBe('mi');
    expect(d.to).toBe('km');
  });
  it('temperature', () => {
    expect(parseConvert('72f to c')!.result).toBeCloseTo(22.22, 2);
    expect(parseConvert('100 celsius in fahrenheit')!.result).toBe(212);
  });
  it('mismatched dimensions → null', () => {
    expect(parseConvert('5 kg to km')).toBeNull();
  });
  it('unknown unit → null', () => {
    expect(parseConvert('5 parsecs to km')).toBeNull();
  });
});
