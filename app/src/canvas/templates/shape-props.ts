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
    case 'opencanvas:markdown':
      return { w: size.w, h: size.h, ...base };
    case 'opencanvas:code-block':
      return { w: size.w, h: size.h, ...base };
    case 'opencanvas:ticket':
      return {
        w: size.w,
        h: size.h,
        ticketId: result.id,
        title: (result.shape as { title?: string }).title ?? 'Untitled',
        ...base,
      };
    case 'opencanvas:web-embed':
      return { w: size.w, h: size.h, url: (result.shape as { url?: string }).url ?? '', ...base };
    case 'opencanvas:key-value-card':
    default:
      return {
        w: size.w,
        h: size.h,
        title: (result.shape as { title?: string }).title ?? result.kind,
        fields: (result.shape as { fields?: Array<{ key: string; value: string }> }).fields ?? [],
        ...base,
      };
  }
}

export const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  'opencanvas:markdown':       { w: 360, h: 240 },
  'opencanvas:code-block':     { w: 480, h: 280 },
  'opencanvas:ticket':         { w: 320, h: 200 },
  'opencanvas:web-embed':      { w: 480, h: 320 },
  'opencanvas:key-value-card': { w: 320, h: 200 },
};
