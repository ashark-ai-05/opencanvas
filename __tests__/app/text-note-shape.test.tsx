import { describe, it, expect } from 'vitest';
import { TextNoteShapeUtil } from '../../app/src/canvas/shapes/text-note';

describe('TextNoteShapeUtil', () => {
  it('declares the namespaced shape type', () => {
    expect(TextNoteShapeUtil.type).toBe('opencanvas:text-note');
  });

  it('exposes a typed props schema', () => {
    expect(TextNoteShapeUtil.props).toBeDefined();
    expect(TextNoteShapeUtil.props.w).toBeDefined();
    expect(TextNoteShapeUtil.props.h).toBeDefined();
    expect(TextNoteShapeUtil.props.text).toBeDefined();
  });

  it('returns sensible default props', () => {
    // Construct a temporary instance to call getDefaultProps;
    // tldraw's ShapeUtil base accepts a null editor for this no-op call shape.
    const util = new TextNoteShapeUtil({} as never);
    const defaults = util.getDefaultProps();
    expect(defaults.w).toBeGreaterThan(0);
    expect(defaults.h).toBeGreaterThan(0);
    expect(typeof defaults.text).toBe('string');
  });
});
