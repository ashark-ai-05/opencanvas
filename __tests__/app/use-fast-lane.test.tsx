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

  it('promote turns a ghost into committed', () => {
    vi.useFakeTimers();
    const { result } = setup('25 min'); // duration only: ghost
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('ghost');
    act(() => result.current.promote());
    expect(result.current.ui.kind).toBe('committed');
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
