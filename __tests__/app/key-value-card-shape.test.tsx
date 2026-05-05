import { describe, it, expect } from 'vitest';
import { KeyValueCardShapeUtil } from '../../app/src/canvas/shapes/key-value-card';

describe('KeyValueCardShapeUtil', () => {
  it('declares opencanvas:key-value-card', () => {
    expect(KeyValueCardShapeUtil.type).toBe('opencanvas:key-value-card');
  });

  it('declares fields as an array prop', () => {
    expect(KeyValueCardShapeUtil.props.fields).toBeDefined();
  });
});
