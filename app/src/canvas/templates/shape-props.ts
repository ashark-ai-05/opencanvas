import type { SearchResult } from '../../api/search';

/**
 * Map a Result + chosen shapeType to the props expected by that
 * shape's ShapeUtil. Mirrors the logic Plan 4d originally inlined into
 * dispatcher.ts; extracted here so all templates share it.
 */
export function shapeProps(
  shapeType: string,
  result: SearchResult,
  size: { w: number; h: number }
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...result.shape, uri: result.provenance.uri };

  switch (shapeType) {
    case 'llm-wiki:markdown':
      return { w: size.w, h: size.h, ...base };
    case 'llm-wiki:code-block':
      return { w: size.w, h: size.h, ...base };
    case 'llm-wiki:ticket':
      return {
        w: size.w,
        h: size.h,
        ticketId: result.id,
        title: (result.shape as { title?: string }).title ?? 'Untitled',
        ...base,
      };
    case 'llm-wiki:web-embed':
      return { w: size.w, h: size.h, url: (result.shape as { url?: string }).url ?? '', ...base };
    case 'llm-wiki:key-value-card':
    default:
      return {
        w: size.w,
        h: size.h,
        title: (result.shape as { title?: string }).title ?? result.kind,
        pairs: (result.shape as { pairs?: Array<{ key: string; value: string }> }).pairs ?? [],
        ...base,
      };
  }
}

export const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  'llm-wiki:markdown':       { w: 360, h: 240 },
  'llm-wiki:code-block':     { w: 480, h: 280 },
  'llm-wiki:ticket':         { w: 320, h: 200 },
  'llm-wiki:web-embed':      { w: 480, h: 320 },
  'llm-wiki:key-value-card': { w: 320, h: 200 },
};
