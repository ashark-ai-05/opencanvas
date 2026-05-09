import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useParallax } from '../../app/src/lib/motion/use-parallax';

// jsdom doesn't ship matchMedia. Default to "reduced-motion: false" so the
// hook returns its active branch unless a test overrides matches=true.
function mockMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reducedMotion && query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  mockMatchMedia(false);
});

describe('useParallax', () => {
  it('returns ref, motion values, and bind handlers', () => {
    const { result } = renderHook(() => useParallax());
    expect(result.current.ref).toBeDefined();
    expect(result.current.rotateX).toBeDefined();
    expect(result.current.rotateY).toBeDefined();
    expect(result.current.translateZ).toBeDefined();
    expect(typeof result.current.bind.onPointerMove).toBe('function');
    expect(typeof result.current.bind.onPointerLeave).toBe('function');
  });

  it('initial motion values are 0 at rest', () => {
    const { result } = renderHook(() => useParallax({ maxTilt: 5 }));
    expect(result.current.rotateX.get()).toBe(0);
    expect(result.current.rotateY.get()).toBe(0);
    expect(result.current.translateZ.get()).toBe(0);
  });

  it('returns inert motion values when prefers-reduced-motion is set', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useParallax({ maxTilt: 5 }));

    // Attach a fake element to the ref via createElement (no innerHTML).
    const el = document.createElement('div');
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    (result.current.ref as React.MutableRefObject<HTMLElement>).current = el;

    // Even after a pointer move, values stay at 0 under reduced motion.
    act(() => {
      result.current.bind.onPointerMove({
        clientX: 200,
        clientY: 100,
      } as PointerEvent);
    });

    expect(result.current.rotateX.get()).toBe(0);
    expect(result.current.rotateY.get()).toBe(0);
    expect(result.current.translateZ.get()).toBe(0);
  });

  it('onPointerLeave does not throw and is callable', () => {
    const { result } = renderHook(() => useParallax({ maxTilt: 5 }));
    const el = document.createElement('div');
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    (result.current.ref as React.MutableRefObject<HTMLElement>).current = el;

    act(() => {
      result.current.bind.onPointerMove({
        clientX: 200,
        clientY: 100,
      } as PointerEvent);
    });
    expect(() => {
      act(() => {
        result.current.bind.onPointerLeave();
      });
    }).not.toThrow();
  });
});
