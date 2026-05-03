import { describe, it, expect, vi } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher';
import { useTemplateStore } from '../../app/src/state/template-store';

function makeEditor() {
  const shapes: { id: string; type: string }[] = [
    { id: 'shape:w-1', type: 'llm-wiki:markdown' },
    { id: 'shape:w-2', type: 'llm-wiki:ticket' },
    { id: 'shape:other', type: 'geo' },
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
  it('clear directive removes only llm-wiki:* shapes', () => {
    const editor = makeEditor();
    applyToolDirective(editor as never, { type: 'clear' }, 'ask-anything');
    expect(editor.shapes).toHaveLength(1);
    expect(editor.shapes[0]!.type).toBe('geo');
  });

  it('clear directive is a no-op when no llm-wiki shapes are present', () => {
    const editor = {
      shapes: [{ id: 'shape:other', type: 'geo' }],
      getCurrentPageShapes: function () {
        return this.shapes;
      },
      deleteShapes: vi.fn(),
      getViewportPageBounds: () => ({ x: 0, y: 0, w: 1200, h: 800 }),
      createShape: vi.fn(),
    };
    applyToolDirective(editor as never, { type: 'clear' }, 'ask-anything');
    expect(editor.deleteShapes).not.toHaveBeenCalled();
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
