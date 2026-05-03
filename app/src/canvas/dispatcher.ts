import type { Editor } from 'tldraw';
import type { SearchResult } from '../api/search';
import { TEMPLATES_BY_ID } from './templates';
import { useTemplateStore } from '../state/template-store';
import type { ToolDirective, TemplateId, WidgetKind } from '../../../src/agent/types';

/**
 * Place results on the canvas using the active template's layout.
 * The layout function returns ShapePlacement[]; we hand each one to
 * editor.createShape.
 */
export function placeResultsOnCanvas(
  editor: Editor,
  results: SearchResult[]
): void {
  if (results.length === 0) return;

  const { activeTemplateId } = useTemplateStore.getState();
  const template = TEMPLATES_BY_ID[activeTemplateId];
  const placements = template.layout(results, editor.getViewportPageBounds());

  for (const p of placements) {
    editor.createShape({
      type: p.shapeType,
      x: p.x,
      y: p.y,
      props: p.props,
    });
  }
}

const KIND_TO_SHAPE: Record<WidgetKind, string> = {
  markdown: 'llm-wiki:markdown',
  'code-block': 'llm-wiki:code-block',
  ticket: 'llm-wiki:ticket',
  'web-embed': 'llm-wiki:web-embed',
  'key-value-card': 'llm-wiki:key-value-card',
};

/**
 * Apply a directive coming from a backend tool to the tldraw editor.
 * `templateId` is the active template at directive-receive time
 * (read from the Zustand template store at the call site).
 */
export function applyToolDirective(
  editor: Editor,
  directive: ToolDirective,
  templateId: TemplateId,
): void {
  switch (directive.type) {
    case 'place': {
      const tpl = TEMPLATES_BY_ID[templateId];
      if (!tpl) throw new Error(`unknown template: ${templateId}`);
      const occupancy = countByRole(editor, directive.role);
      const slot = tpl.slotForRole(
        directive.role,
        occupancy,
        editor.getViewportPageBounds(),
      );
      editor.createShape({
        id: ('shape:' + directive.id) as never,
        type: KIND_TO_SHAPE[directive.kind] as never,
        x: slot.x,
        y: slot.y,
        props: { ...directive.payload, w: slot.w, h: slot.h } as never,
      } as never);
      return;
    }
    case 'clear': {
      const ids = editor
        .getCurrentPageShapes()
        .filter((s) => s.type.startsWith('llm-wiki:'))
        .map((s) => s.id);
      if (ids.length > 0) editor.deleteShapes(ids as never[]);
      return;
    }
    case 'switchTemplate': {
      useTemplateStore.getState().setActiveTemplateId(directive.id);
      return;
    }
    default:
      // Remaining directive types (focus/link) added in T25-T26.
      throw new Error(
        `applyToolDirective: directive type "${(directive as { type: string }).type}" not implemented yet`,
      );
  }
}

function countByRole(_editor: Editor, _role: string): number {
  // T28 plumbs role tracking via shape meta; for now everything is occupancy 0.
  return 0;
}
