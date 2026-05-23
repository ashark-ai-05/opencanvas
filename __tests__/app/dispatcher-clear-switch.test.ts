import { describe, it, expect, vi } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher';
import { useTemplateStore } from '../../app/src/state/template-store';

type ShapeLite = {
  id: string;
  type: string;
  meta?: Record<string, unknown>;
};

function makeEditor(initial?: ShapeLite[]) {
  const shapes: ShapeLite[] =
    initial ?? [
      { id: 'shape:w-1', type: 'opencanvas:markdown' },
      { id: 'shape:w-2', type: 'opencanvas:ticket' },
      { id: 'shape:draw-1', type: 'draw' },
      { id: 'shape:pinned', type: 'opencanvas:markdown', meta: { pinned: true } },
    ];
  return {
    shapes,
    getCurrentPageShapes: () => shapes,
    deleteShapes: (ids: string[]) => {
      for (const id of ids) {
        const i = shapes.findIndex((s) => s.id === id);
        if (i >= 0) shapes.splice(i, 1);
      }
    },
    getViewportPageBounds: () => ({ x: 0, y: 0, w: 1200, h: 800 }),
    createShape: vi.fn(),
  };
}

describe('applyToolDirective — clear & switchTemplate', () => {
  it('clear removes all non-pinned shapes (including native drawings)', () => {
    const editor = makeEditor();
    applyToolDirective(editor as never, { type: 'clear' }, 'ask-anything');
    expect(editor.shapes).toHaveLength(1);
    expect(editor.shapes[0]!.id).toBe('shape:pinned');
  });

  it('clear is a no-op when only pinned shapes remain', () => {
    const editor = makeEditor([
      { id: 'shape:pinned', type: 'opencanvas:markdown', meta: { pinned: true } },
    ]);
    const spy = vi.spyOn(editor, 'deleteShapes');
    applyToolDirective(editor as never, { type: 'clear' }, 'ask-anything');
    expect(spy).not.toHaveBeenCalled();
  });

  it('switchTemplate updates the Zustand store', () => {
    useTemplateStore.setState({ activeTemplateId: 'ask-anything' });
    const editor = makeEditor();
    applyToolDirective(
      editor as never,
      { type: 'switchTemplate', id: 'tell-me-about-x' },
      'ask-anything',
    );
    expect(useTemplateStore.getState().activeTemplateId).toBe('tell-me-about-x');
    // Reset to default for other tests
    useTemplateStore.setState({ activeTemplateId: 'ask-anything' });
  });
});
