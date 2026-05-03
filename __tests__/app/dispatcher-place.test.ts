import { describe, it, expect } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher';
import type { ToolDirective, WidgetKind } from '../../src/agent/types';

function makeEditor() {
  const calls: { type: string; x: number; y: number; meta?: { role?: string }; props: Record<string, unknown> }[] = [];
  return {
    calls,
    getCurrentPageShapes: () => [],   // empty by default; T28 stacking test uses its own editor
    getViewportPageBounds: () => ({ x: 0, y: 0, w: 1200, h: 800 }),
    createShape: (s: { type: string; x: number; y: number; meta?: { role?: string }; props: Record<string, unknown> }) => {
      calls.push({ type: s.type, x: s.x, y: s.y, meta: s.meta, props: s.props });
    },
  } as never;
}

describe('applyToolDirective — place', () => {
  it('creates a markdown shape with payload props', () => {
    const editor = makeEditor();
    const d: ToolDirective = {
      type: 'place',
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      payload: { title: 't', body: 'b' },
    };
    applyToolDirective(editor, d, 'ask-anything');
    const calls = (editor as unknown as { calls: { type: string; props: Record<string, unknown> }[] }).calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe('llm-wiki:markdown');
    expect(calls[0]!.props.title).toBe('t');
    expect(calls[0]!.props.body).toBe('b');
  });

  it('uses slotForRole coords from the active template', () => {
    const editor = makeEditor();
    const d: ToolDirective = {
      type: 'place',
      id: 'w-2',
      kind: 'markdown',
      role: 'related',
      payload: { title: 't', body: 'b' },
    };
    applyToolDirective(editor, d, 'ask-anything');
    const calls = (editor as unknown as { calls: { x: number }[] }).calls;
    // ask-anything: related is column 2; x = 0 + 80 + 2*(320+60) = 840
    expect(calls[0]!.x).toBe(840);
  });

  it('throws on unknown directive type', () => {
    const editor = makeEditor();
    expect(() =>
      applyToolDirective(
        editor,
        { type: 'bogus-directive-type' as never } as ToolDirective,
        'ask-anything',
      ),
    ).toThrow(/unknown directive type/);
  });

  it('maps each WidgetKind to its tldraw shape type', () => {
    const editor = makeEditor();
    const kinds: Array<{ kind: WidgetKind; expected: string }> = [
      { kind: 'markdown', expected: 'llm-wiki:markdown' },
      { kind: 'code-block', expected: 'llm-wiki:code-block' },
      { kind: 'ticket', expected: 'llm-wiki:ticket' },
      { kind: 'web-embed', expected: 'llm-wiki:web-embed' },
      { kind: 'key-value-card', expected: 'llm-wiki:key-value-card' },
    ];
    for (const { kind, expected } of kinds) {
      const calls = (editor as unknown as { calls: unknown[] }).calls;
      calls.length = 0;
      applyToolDirective(
        editor,
        // payload shape varies per kind; pass an empty object — the dispatcher
        // forwards verbatim and the test only inspects shape `type`.
        { type: 'place', id: `w-${kind}`, kind, role: 'primary', payload: {} as never } as ToolDirective,
        'ask-anything',
      );
      const c = (editor as unknown as { calls: { type: string }[] }).calls;
      expect(c[0]!.type).toBe(expected);
    }
  });

  it('stores role in shape.meta so computeCanvasSnapshot can read it back', () => {
    const editor = makeEditor();
    applyToolDirective(
      editor,
      {
        type: 'place',
        id: 'w-meta',
        kind: 'markdown',
        role: 'related',
        payload: { title: 't', body: 'b' },
      },
      'ask-anything',
    );
    const calls = (editor as unknown as { calls: { meta?: { role?: string } }[] }).calls;
    expect(calls[0]!.meta?.role).toBe('related');
  });

  it('countByRole increments per-role occupancy when stacking', () => {
    // Place two markdown shapes both at role:related — second one should land below.
    const shapes: Array<{ id: string; type: string; meta?: { role?: string } }> = [];
    const calls: { x: number; y: number; meta?: { role?: string } }[] = [];
    const editor = {
      getCurrentPageShapes: () => shapes,
      getViewportPageBounds: () => ({ x: 0, y: 0, w: 1200, h: 800 }),
      createShape: (s: { id: string; type: string; x: number; y: number; meta?: { role?: string } }) => {
        shapes.push({ id: s.id, type: s.type, meta: s.meta });
        calls.push({ x: s.x, y: s.y, meta: s.meta });
      },
    } as never;

    applyToolDirective(
      editor,
      { type: 'place', id: 'a', kind: 'markdown', role: 'related', payload: { title: 'a', body: '' } },
      'ask-anything',
    );
    applyToolDirective(
      editor,
      { type: 'place', id: 'b', kind: 'markdown', role: 'related', payload: { title: 'b', body: '' } },
      'ask-anything',
    );

    expect(calls).toHaveLength(2);
    // ask-anything's slotForRole stacks vertically by occupancy * (h+20):
    //   first: y = 100 + 0*220 = 100
    //   second: y = 100 + 1*220 = 320
    expect(calls[0]!.y).toBe(100);
    expect(calls[1]!.y).toBe(320);
  });
});
