import type { Editor } from 'tldraw';

/**
 * Canvas export utilities.
 *
 * PNG export: tldraw's `editor.toImage` rasterises a shape array (or all
 * shapes) to a Blob. We collect every opencanvas:* shape on the page,
 * pad the bounds, and stream the Blob to a hidden <a download>.
 *
 * Markdown export: walks shapes by role and emits a flat Markdown
 * doc with one section per widget. Tries to round-trip the most
 * common payload kinds (markdown, code-block, kv, table, ticket,
 * web-embed, sticky-note, generic). Anything we don't know is
 * dumped as a JSON fenced block so nothing is silently lost.
 */
type ShapeLite = {
  id: string;
  type: string;
  meta?: Record<string, unknown>;
  props: Record<string, unknown>;
};

function opencanvasShapes(editor: Editor): ShapeLite[] {
  return (
    editor.getCurrentPageShapes() as unknown as ShapeLite[]
  ).filter((s) => s.type.startsWith('opencanvas:'));
}

/**
 * Export the canvas as a PNG. Triggers a browser download. Returns
 * `false` when the canvas is empty (caller can show a toast).
 */
export async function exportCanvasAsPng(
  editor: Editor,
  filename = 'opencanvas.png',
): Promise<boolean> {
  const shapes = opencanvasShapes(editor);
  if (shapes.length === 0) return false;

  const ids = shapes.map((s) => s.id) as never;
  const result = await (
    editor as unknown as {
      toImage: (
        ids: never,
        opts?: { format?: 'png' | 'svg' | 'jpeg' | 'webp'; padding?: number; background?: boolean },
      ) => Promise<{ blob: Blob }>;
    }
  ).toImage(ids, { format: 'png', padding: 32, background: true });

  triggerDownload(result.blob, filename);
  return true;
}

/**
 * Export the canvas as Markdown. The shape order is roughly
 * top-to-bottom / left-to-right (sorted by y then x), so the document
 * reads in roughly the same order the user laid it out.
 */
export function exportCanvasAsMarkdown(editor: Editor): string {
  const shapes = (
    editor.getCurrentPageShapes() as unknown as Array<
      ShapeLite & { x: number; y: number }
    >
  )
    .filter((s) => s.type.startsWith('opencanvas:'))
    .sort((a, b) =>
      Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x,
    );

  if (shapes.length === 0) return '# OpenCanvas\n\n_(empty canvas)_\n';

  const out: string[] = ['# OpenCanvas', ''];
  for (const s of shapes) {
    const role = (s.meta?.['role'] as string | undefined) ?? 'primary';
    const kind = s.type.replace(/^opencanvas:/, '');
    const title = (s.props['title'] as string | undefined) ?? kind;
    out.push(`## ${title}  \n_${kind} · ${role}_`);
    out.push('');
    out.push(formatShapeBody(s));
    out.push('');
    out.push('---');
    out.push('');
  }
  return out.join('\n');
}

/** Per-kind Markdown serializer. Best-effort; falls back to JSON. */
function formatShapeBody(s: ShapeLite): string {
  const p = s.props;
  switch (s.type) {
    case 'opencanvas:markdown':
      return String(p['body'] ?? '');
    case 'opencanvas:code-block': {
      const lang = (p['language'] as string) ?? '';
      const code = (p['code'] as string) ?? '';
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case 'opencanvas:web-embed': {
      const url = String(p['url'] ?? '');
      const snippet = (p['snippet'] as string) ?? '';
      return `[${url}](${url})${snippet ? `\n\n${snippet}` : ''}`;
    }
    case 'opencanvas:ticket':
      return [
        `**${p['ticketId'] ?? ''}** · ${p['status'] ?? ''}`,
        p['assignee'] ? `Assigned to: ${p['assignee']}` : '',
        p['description'] ?? '',
      ]
        .filter(Boolean)
        .join('\n\n');
    case 'opencanvas:key-value-card': {
      const fields = Array.isArray(p['fields'])
        ? (p['fields'] as Array<{ key: string; value: string; url?: string }>)
        : [];
      return fields
        .map((f) =>
          `- **${f.key}** — ${f.url ? `[${f.value}](${f.url})` : f.value}`,
        )
        .join('\n');
    }
    case 'opencanvas:table': {
      const cols = (p['columns'] as Array<{ key: string; label?: string }>) ?? [];
      const rows = (p['rows'] as string[][]) ?? [];
      const head = `| ${cols.map((c) => c.label ?? c.key).join(' | ')} |`;
      const sep = `| ${cols.map(() => '---').join(' | ')} |`;
      const body = rows
        .map((r) => `| ${r.join(' | ')} |`)
        .join('\n');
      return [head, sep, body].filter(Boolean).join('\n');
    }
    case 'opencanvas:tasks': {
      const items = Array.isArray(p['items'])
        ? (p['items'] as Array<{ text: string; done?: boolean; assignee?: string }>)
        : [];
      return items
        .map(
          (i) =>
            `- [${i.done ? 'x' : ' '}] ${i.text}${i.assignee ? ` _(${i.assignee})_` : ''}`,
        )
        .join('\n');
    }
    case 'opencanvas:sticky-note':
      return `> ${(p['body'] as string) ?? ''}`;
    case 'opencanvas:generic': {
      const blocks = Array.isArray(p['blocks'])
        ? (p['blocks'] as Array<Record<string, unknown>>)
        : [];
      return blocks.map((b) => formatGenericBlock(b)).join('\n\n');
    }
    case 'opencanvas:time': {
      const mode = String(p['mode'] ?? 'clock');
      const label = (p['label'] as string) ?? mode;
      return `_${label} (${mode})_`;
    }
    default: {
      // Unknown kind — dump props as JSON so nothing is lost.
      return `\`\`\`json\n${JSON.stringify(p, null, 2)}\n\`\`\``;
    }
  }
}

function formatGenericBlock(b: Record<string, unknown>): string {
  switch (b['type']) {
    case 'markdown':
      return String(b['content'] ?? '');
    case 'kv': {
      const fields = (b['fields'] as Array<{ key: string; value: string; url?: string }>) ?? [];
      return fields
        .map((f) =>
          `- **${f.key}** — ${f.url ? `[${f.value}](${f.url})` : f.value}`,
        )
        .join('\n');
    }
    case 'table': {
      const cols = (b['columns'] as Array<{ key: string; label?: string }>) ?? [];
      const rows = (b['rows'] as string[][]) ?? [];
      const head = `| ${cols.map((c) => c.label ?? c.key).join(' | ')} |`;
      const sep = `| ${cols.map(() => '---').join(' | ')} |`;
      const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
      return [head, sep, body].filter(Boolean).join('\n');
    }
    case 'embed':
      return `<${String(b['url'] ?? '')}>`;
    case 'json':
      return `\`\`\`json\n${JSON.stringify(b['data'], null, 2)}\n\`\`\``;
    default:
      return `\`\`\`json\n${JSON.stringify(b, null, 2)}\n\`\`\``;
  }
}

/** Trigger a download of an in-memory Blob. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the click so the browser's reader has time to read.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Trigger a download of a string as a UTF-8 file. */
export function downloadText(
  text: string,
  filename: string,
  mime = 'text/markdown',
): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  triggerDownload(blob, filename);
}
