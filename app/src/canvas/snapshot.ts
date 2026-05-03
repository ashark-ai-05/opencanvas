import type { Editor } from 'tldraw';
import type {
  WidgetKind,
  Role,
  TemplateId,
} from '../../../src/agent/types';

const SHAPE_TO_KIND: Record<string, WidgetKind> = {
  'strata:markdown': 'markdown',
  'strata:code-block': 'code-block',
  'strata:ticket': 'ticket',
  'strata:web-embed': 'web-embed',
  'strata:key-value-card': 'key-value-card',
  'strata:table': 'table',
  'strata:timeline': 'timeline',
  'strata:file-tree': 'file-tree',
};

export type CanvasSnapshotShape = {
  activeTemplateId: TemplateId;
  widgets: Array<{
    id: string;
    kind: WidgetKind;
    role: Role;
    title: string;
    payload: Record<string, unknown>;
  }>;
  /** IDs (without "shape:" prefix) of widgets the user currently has
   *  selected. The agent uses this to scope follow-up questions to specific
   *  widgets rather than the whole canvas. */
  selectedIds?: string[];
};

/**
 * Walk page shapes, keep only strata:* widgets, return the snapshot
 * the backend expects. Cheap; called per chat submit.
 */
export function computeCanvasSnapshot(
  editor: Editor,
  activeTemplateId: TemplateId,
): CanvasSnapshotShape {
  const shapes = editor.getCurrentPageShapes() as Array<{
    id: string;
    type: string;
    meta?: Record<string, unknown>;
    props: Record<string, unknown>;
  }>;
  const widgets = shapes
    .filter((s) => SHAPE_TO_KIND[s.type] !== undefined)
    .map((s) => ({
      // shape ids are 'shape:<uuid>'; strip the prefix to recover the directive id.
      id: s.id.replace(/^shape:/, ''),
      kind: SHAPE_TO_KIND[s.type]!,
      role: ((s.meta?.['role'] as Role) ?? 'primary') as Role,
      title: ((s.props['title'] as string) ?? s.id) as string,
      payload: { ...s.props },
    }));

  // tldraw exposes selection via editor.getSelectedShapeIds() — strip prefix
  // and filter to strata:* shapes only (user might have selected a stray
  // tldraw geo/arrow that isn't a Strata widget).
  const selectedTldrawIds = (
    (editor as unknown as { getSelectedShapeIds?: () => string[] })
      .getSelectedShapeIds?.() ?? []
  );
  const widgetIdSet = new Set(widgets.map((w) => `shape:${w.id}`));
  const selectedIds = selectedTldrawIds
    .filter((id) => widgetIdSet.has(id))
    .map((id) => id.replace(/^shape:/, ''));

  return {
    activeTemplateId,
    widgets,
    ...(selectedIds.length > 0 ? { selectedIds } : {}),
  };
}
