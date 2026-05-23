import { describe, it, expect } from 'vitest';
import { MarkdownShapeUtil } from '../../app/src/canvas/shapes/markdown';

describe('MarkdownShapeUtil', () => {
  it('declares the namespaced shape type', () => {
    expect(MarkdownShapeUtil.type).toBe('opencanvas:markdown');
  });

  it('declares the typed props schema', () => {
    expect(MarkdownShapeUtil.props.w).toBeDefined();
    expect(MarkdownShapeUtil.props.h).toBeDefined();
    expect(MarkdownShapeUtil.props.body).toBeDefined();
  });
});
