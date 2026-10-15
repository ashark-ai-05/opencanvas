import { useEffect, useState } from 'react';

/**
 * Phones and narrow tablets get a docked bottom-sheet chat instead of the
 * draggable floating window. Must match the `@media (max-width: 640px)`
 * block in styles/globals.css.
 */
export const NARROW_MAX_WIDTH = 640;
export const NARROW_QUERY = `(max-width: ${NARROW_MAX_WIDTH}px)`;

export function isNarrowWidth(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width <= NARROW_MAX_WIDTH;
}

function readNarrow(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(NARROW_QUERY).matches;
  }
  return isNarrowWidth(window.innerWidth);
}

export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(readNarrow);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setNarrow(readNarrow());
    window.addEventListener('resize', update);
    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(NARROW_QUERY)
        : null;
    mql?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      mql?.removeEventListener?.('change', update);
    };
  }, []);
  return narrow;
}
