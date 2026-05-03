import { describe, it, expect } from 'vitest';
import { CodeBlockShapeUtil } from '../../app/src/canvas/shapes/code-block';

describe('CodeBlockShapeUtil', () => {
  it('declares strata:code-block', () => {
    expect(CodeBlockShapeUtil.type).toBe('strata:code-block');
  });

  it('exposes language, code, source + legacy symbolName/filePath in props', () => {
    expect(CodeBlockShapeUtil.props.language).toBeDefined();
    expect(CodeBlockShapeUtil.props.code).toBeDefined();
    expect(CodeBlockShapeUtil.props.source).toBeDefined();
    expect(CodeBlockShapeUtil.props.symbolName).toBeDefined();
    expect(CodeBlockShapeUtil.props.filePath).toBeDefined();
  });
});
