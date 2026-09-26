import { describe, it, expect, beforeEach } from 'vitest';
import {
  useUserSettings,
  resolveFastLaneEnabled,
} from '../../app/src/state/user-settings-store';

beforeEach(() => useUserSettings.getState().reset());

describe('fast lane setting', () => {
  it('defaults to null (auto)', () => {
    expect(useUserSettings.getState().fastLane).toBeNull();
  });
  it('auto = on locally, off in demo', () => {
    expect(resolveFastLaneEnabled(null, false)).toBe(true);
    expect(resolveFastLaneEnabled(null, true)).toBe(false);
  });
  it('an explicit choice wins over demo', () => {
    expect(resolveFastLaneEnabled(true, true)).toBe(true);
    expect(resolveFastLaneEnabled(false, false)).toBe(false);
  });
  it('update persists the flag and reset clears it', () => {
    useUserSettings.getState().update({ fastLane: false });
    expect(useUserSettings.getState().fastLane).toBe(false);
    useUserSettings.getState().reset();
    expect(useUserSettings.getState().fastLane).toBeNull();
  });
});
