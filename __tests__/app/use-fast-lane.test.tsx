import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFastLane, FAST_LANE_DEBOUNCE_MS } from '../../app/src/hooks/useFastLane';

const REF = () => new Date('2026-09-26T09:00:00');

function setup(initial: string, enabled = true) {
  return renderHook(({ text, on }) => useFastLane(text, { enabled: on, ref: REF }), {
    initialProps: { text: initial, on: enabled },
  });
}

afterEach(() => vi.useRealTimers());

describe('useFastLane', () => {
  it('starts in input and commits after the debounce', () => {
    vi.useFakeTimers();
    const { result } = setup('25 min timer');
    expect(result.current.ui.kind).toBe('input');
    act(() => vi.advanceTimersByTime(FAST_LANE_DEBOUNCE_MS + 1));
    expect(result.current.ui.kind).toBe('committed');
    expect(result.current.resolved?.kind).toBe('time');
    expect(result.current.resolved?.summary).toBe('Timer 25:00');
    expect(result.current.resolved?.payload).toEqual({ mode: 'timer', durationSec: 1500 });
  });

  it('disabled → always input, no timers scheduled', () => {
    vi.useFakeTimers();
    const { result } = setup('25 min timer', false);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.ui.kind).toBe('input');
    expect(result.current.resolved).toBeNull();
  });

  it('escaped text is never classified', () => {
    vi.useFakeTimers();
    const { result } = setup('/clear');
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.ui.kind).toBe('input');
  });

  it('dismiss holds until the text changes substantially', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('25 min timer');
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
    act(() => result.current.dismiss());
    expect(result.current.ui.kind).toBe('input');
    rerender({ text: '25 min timers', on: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('input');
    rerender({ text: 'buy milk, eggs, bread', on: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
    expect(result.current.resolved?.kind).toBe('tasks');
  });

  it('clearing the box releases a stuck dismissal (fix 10)', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('25 min timer');
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
    act(() => result.current.dismiss());
    expect(result.current.ui.kind).toBe('input');
    rerender({ text: '', on: true });
    act(() => vi.advanceTimersByTime(200));
    rerender({ text: '20 min timer', on: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
  });

  it('promote turns a ghost into committed', () => {
    vi.useFakeTimers();
    const { result } = setup('25 min'); // duration only: ghost
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('ghost');
    act(() => result.current.promote());
    expect(result.current.ui.kind).toBe('committed');
  });

  it('drops a stale committed intent once support falls away (fix 1a)', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('buy milk, eggs, bread');
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
    expect(result.current.resolved?.kind).toBe('tasks');
    rerender({ text: '25 min', on: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).not.toBe('committed');
    expect(result.current.resolved?.kind).not.toBe('tasks');
  });

  it('placeable goes false once the committed intent no longer matches a fresh classify (fix 1b)', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('25 min timer');
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
    expect(result.current.placeable).toBe(true);
    rerender({ text: '25 min timer is too short, what do you think?', on: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.placeable).toBe(false);
  });

  it('a freshly committed intent is placeable (fix 1c)', () => {
    vi.useFakeTimers();
    const { result } = setup('25 min timer');
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
    expect(result.current.placeable).toBe(true);
  });

  it('a huge string while committed resolves to null without throwing (fix 4)', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('25 min timer');
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
    const huge = 'x'.repeat(6000);
    expect(() => rerender({ text: huge, on: true })).not.toThrow();
    expect(result.current.resolved).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.resolved).toBeNull();
  });

  it('choose forces an option', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('25 min timer');
    act(() => vi.advanceTimersByTime(200));
    // Force the choose state through the public API: pick(1) on a non-choose is a no-op…
    act(() => result.current.choose(0));
    expect(result.current.ui.kind).toBe('committed');
    // …and forcing an intent locks it against small edits.
    rerender({ text: '25 min timer!', on: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui).toMatchObject({ kind: 'committed', intent: 'timer' });
  });
});
