import { describe, it, expect, beforeEach } from 'vitest';
import { useStarNudge } from '../../app/src/state/star-nudge-store';

describe('star nudge store', () => {
  beforeEach(() => {
    localStorage.removeItem('opencanvas:star-nudge:v1');
    useStarNudge.setState({ visible: false });
  });
  it('offers once until dismissed', () => {
    useStarNudge.getState().offer();
    expect(useStarNudge.getState().visible).toBe(true);
    useStarNudge.getState().offer(); // no-op while visible
    expect(useStarNudge.getState().visible).toBe(true);
    useStarNudge.getState().dismiss();
    expect(useStarNudge.getState().visible).toBe(false);
    expect(localStorage.getItem('opencanvas:star-nudge:v1')).toBe('1');
    useStarNudge.getState().offer();
    expect(useStarNudge.getState().visible).toBe(false);
  });
});
