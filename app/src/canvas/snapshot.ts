import type { Editor } from 'tldraw';
import type {
  WidgetKind,
  Role,
  TemplateId,
} from '../../../src/agent/types';

const SHAPE_TO_KIND: Record<string, WidgetKind> = {
  'llm-wiki:markdown': 'markdown',
  'llm-wiki:code-block': 'code-block',
  'llm-wiki:ticket': 'ticket',
  'llm-wiki:web-embed': 'web-embed',
  'llm-wiki:key-value-card': 'key-value-card',
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
};

/**
 * Walk page shapes, keep only llm-wiki:* widgets, return the snapshot
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
  return { activeTemplateId, widgets };
}
