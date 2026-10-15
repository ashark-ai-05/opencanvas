import { describe, it, expect } from 'vitest';
import { classify } from '../../../app/src/intent/classify';
import { rawState } from '../../../app/src/intent/decide';
import { REF } from './helpers';

const state = (t: string) => rawState(classify(t, { ref: REF }));

describe('todo / checklist lead keyword', () => {
  it.each(['todo: buy milk', 'todo: ship the demo', 'checklist: record the GIF, write the README, ship'])(
    'commits %s',
    (t) => expect(state(t)).toEqual({ kind: 'committed', intent: 'todo' }),
  );
  it.each(['write a todo app', 'build a checklist component'])(
    'stays on the model path for %s',
    (t) => expect(state(t).kind).toBe('input'),
  );
});
