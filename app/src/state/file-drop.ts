import { useEffect } from 'react';
import { toast } from 'sonner';
import { useChatActions } from './chat-actions-store';
import { getEditor } from './editor-ref';
import { useTemplateStore } from './template-store';
import { applyToolDirective } from '../canvas/dispatcher';

/**
 * Global file-drop handler. When a file is dragged onto the OpenCanvas
 * window, POST it to /v1/canvas/upload, then fire a chat turn that
 * frames the extracted text for the agent.
 *
 * The agent sees the file's content as a normal user message + a
 * directive to summarise. From there it can place_widget any number
 * of times (markdown, table, kv, generic, etc.) to capture the
 * document on the canvas.
 *
 * Why a chat turn instead of a direct widget place: the agent picks
 * the right kinds, splits long docs into multiple widgets, and the
 * user gets a thinking trace. Direct placement would lose that
 * intelligence.
 */
const SUPPORTED = new Set(['.md', '.markdown', '.txt', '.rst', '.adoc', '.yaml', '.yml', '.json', '.pdf', '.docx', '.xlsx']);

export function useFileDrop(): void {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      // Show the "drop ok" cursor when files OR URLs are being dragged.
      // text/uri-list is what browsers populate when the user drags
      // a tab from another window or a link from a webpage.
      if (
        e.dataTransfer &&
        (hasFiles(e.dataTransfer) || hasUrl(e.dataTransfer))
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDrop = async (e: DragEvent) => {
      // Don't intercept drops that happen inside form/input elements
      // (the user is probably attaching to a different control).
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      // URL drag (from another tab / a link) → embed widget. Checked
      // BEFORE files so a user dragging a link from another browser
      // window doesn't surprise-upload anything.
      if (e.dataTransfer && hasUrl(e.dataTransfer)) {
        const url = readUrl(e.dataTransfer);
        if (url) {
          e.preventDefault();
          e.stopPropagation();
          embedUrl(url);
          return;
        }
      }

      // File drop — existing behavior.
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();

      for (const file of Array.from(files)) {
        await handleOne(file);
      }
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}

async function handleOne(file: File): Promise<void> {
  const ext = ('.' + (file.name.split('.').pop() ?? '')).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    toast.error(`Unsupported file type: ${ext}`, {
      description:
        'Try: .md, .txt, .pdf, .docx, .xlsx, .json, .yaml — or drop the URL on the chat for a web-embed.',
    });
    return;
  }
  const sendChat = useChatActions.getState().sendChat;
  if (!sendChat) {
    toast.error('Chat not ready');
    return;
  }
  const tid = toast.loading(`Reading ${file.name}…`);
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/v1/canvas/upload', { method: 'POST', body: fd });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      text?: string;
      truncated?: boolean;
      chars?: number;
    };
    if (!res.ok || !json.ok || !json.text) {
      throw new Error(json.error ?? `upload failed (${res.status})`);
    }
    toast.success(`Read ${file.name}`, {
      id: tid,
      description: `${json.chars?.toLocaleString() ?? '?'} chars${json.truncated ? ' (truncated)' : ''}`,
    });
    // Frame the prompt so the agent treats the text as a document to
    // summarise into widgets. Keep the literal text as a fenced block.
    const lang = ext === '.md' || ext === '.markdown' ? 'markdown' : 'text';
    const prompt = [
      `I just dropped \`${file.name}\` onto the canvas (${json.chars?.toLocaleString() ?? '?'} chars${json.truncated ? ', truncated' : ''}).`,
      '',
      'Place 1-3 widgets summarizing the most useful content. Use specialized kinds when the content fits (table for tabular data, key-value-card for stat lists, code-block for code), otherwise use generic with markdown blocks.',
      '',
      `Document content:`,
      '',
      '```' + lang,
      json.text,
      '```',
    ].join('\n');
    sendChat(prompt);
  } catch (e) {
    toast.error(`Could not read ${file.name}`, {
      id: tid,
      description: e instanceof Error ? e.message : String(e),
    });
  }
}

function hasFiles(dt: DataTransfer): boolean {
  if (!dt.types) return false;
  for (const t of dt.types) if (t === 'Files') return true;
  return false;
}

/** True when the drag carries a URL (text/uri-list, set by browsers
 *  on tab / link drags). text/plain is treated as a URL hint too —
 *  many tools paste the URL there. */
function hasUrl(dt: DataTransfer): boolean {
  if (!dt.types) return false;
  for (const t of dt.types) if (t === 'text/uri-list' || t === 'text/plain') return true;
  return false;
}

/** Pull a single URL out of a DataTransfer. Prefers text/uri-list
 *  (the browser-native format), falls back to text/plain. Returns
 *  null when the payload doesn't parse as an http/https URL. */
function readUrl(dt: DataTransfer): string | null {
  const candidates = [
    dt.getData('text/uri-list'),
    dt.getData('text/plain'),
  ].filter(Boolean);
  for (const raw of candidates) {
    // text/uri-list can contain comments + multiple URLs; first non-#
    // line is the canonical one.
    const line = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0 && !s.startsWith('#'));
    if (!line) continue;
    if (/^https?:\/\/\S+$/i.test(line)) return line;
  }
  return null;
}

/** Drop a web-embed widget for the given URL via the canvas
 *  dispatcher. Toasts the host on success; reports the failure
 *  reason if the dispatcher throws. */
function embedUrl(url: string): void {
  const editor = getEditor();
  if (!editor) {
    toast.error('Canvas not ready');
    return;
  }
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    toast.error('Invalid URL', { description: url });
    return;
  }
  const tplId = useTemplateStore.getState().activeTemplateId;
  try {
    applyToolDirective(
      editor,
      {
        type: 'place',
        id: crypto.randomUUID(),
        kind: 'web-embed',
        role: 'primary',
        payload: { title: host, url },
      },
      tplId,
    );
    toast(`Embedded ${host}`);
  } catch (e) {
    toast.error('Could not embed', {
      description: e instanceof Error ? e.message : String(e),
    });
  }
}
