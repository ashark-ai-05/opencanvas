import { useEffect } from 'react';
import { toast } from 'sonner';
import { useChatActions } from './chat-actions-store';

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
      // Show the "drop ok" cursor when files are being dragged.
      if (e.dataTransfer && hasFiles(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDrop = async (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      // Don't intercept drops that happen inside form/input elements
      // (the user is probably attaching to a different control).
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
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
