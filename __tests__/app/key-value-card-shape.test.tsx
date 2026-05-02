import { describe, it, expect } from 'vitest';
import { KeyValueCardShapeUtil } from '../../app/src/canvas/shapes/key-value-card';

describe('KeyValueCardShapeUtil', () => {
  it('declares llm-wiki:key-value-card', () => {
    expect(KeyValueCardShapeUtil.type).toBe('llm-wiki:key-value-card');
  });

  it('declares pairs as an array prop', () => {
    expect(KeyValueCardShapeUtil.props.pairs).toBeDefined();
  });
});
