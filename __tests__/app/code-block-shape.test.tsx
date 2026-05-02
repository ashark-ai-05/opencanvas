import { describe, it, expect } from 'vitest';
import { CodeBlockShapeUtil } from '../../app/src/canvas/shapes/code-block';

describe('CodeBlockShapeUtil', () => {
  it('declares llm-wiki:code-block', () => {
    expect(CodeBlockShapeUtil.type).toBe('llm-wiki:code-block');
  });

  it('exposes language, symbolName, filePath, body in props', () => {
    expect(CodeBlockShapeUtil.props.language).toBeDefined();
    expect(CodeBlockShapeUtil.props.symbolName).toBeDefined();
    expect(CodeBlockShapeUtil.props.filePath).toBeDefined();
    expect(CodeBlockShapeUtil.props.body).toBeDefined();
  });
});
