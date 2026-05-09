import { describe, it, expect, vi } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher';

describe('applyToolDirective — link', () => {
  it('creates an arrow shape between two shapes with optional label', () => {
    const createShape = vi.fn();
    const editor = {
      getShape: vi.fn((id: string) => ({
        id,
        x: id === 'shape:w-1' ? 0 : 600,
        y: 0,
        props: { w: 320, h: 200 },
      })),
      createShape,
    } as never;
    applyToolDirective(
      editor,
      {
        type: 'link',
        linkId: 'l-1',
        fromId: 'w-1',
        toId: 'w-2',
        label: 'implements',
      },
      'ask-anything',
    );
    expect(createShape).toHaveBeenCalledTimes(1);
    const arg = (createShape as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as { type: string; id: string; props: Record<string, unknown> };
    expect(arg.type).toBe('arrow');
    expect(arg.id).toBe('shape:l-1');
    expect(arg.props.text).toBe('implements');
    // Endpoints should be the shape centers
    expect(arg.props.start).toEqual({ x: 160, y: 100 }); // 0 + 320/2, 0 + 200/2
    expect(arg.props.end).toEqual({ x: 760, y: 100 });   // 600 + 320/2, 0 + 200/2
  });

  it('omits the label when not provided', () => {
    const createShape = vi.fn();
    const editor = {
      getShape: vi.fn(() => ({ x: 0, y: 0, props: { w: 320, h: 200 } })),
      createShape,
    } as never;
    applyToolDirective(
      editor,
      { type: 'link', linkId: 'l-2', fromId: 'w-1', toId: 'w-2' },
      'ask-anything',
    );
    const arg = (createShape as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as { props: { text: string } };
    expect(arg.props.text).toBe('');
  });

  it('warns + no-ops when either endpoint shape is missing (was throwing — caused tool turns to fail on hallucinated/deleted ids)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const createShape = vi.fn();
    const editor = {
      getShape: vi.fn().mockReturnValue(undefined),
      createShape,
    } as never;
    expect(() =>
      applyToolDirective(
        editor,
        { type: 'link', linkId: 'l-3', fromId: 'w-x', toId: 'w-y' },
        'ask-anything',
      ),
    ).not.toThrow();
    expect(createShape).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('link: missing shape'),
    );
    warnSpy.mockRestore();
  });
});
