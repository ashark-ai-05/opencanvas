import { Loader2 } from 'lucide-react';
import { useUiStore } from '../state/ui-store';

/**
 * Tiny pill rendered above the composer while a chat turn is mid-stream.
 * Hidden via CSS when `chatBusy` is false (no DOM thrash).
 *
 * Spec: REPLICATION-PROMPT.md §13 — `StreamingComposerStatus`.
 */
export function StreamingComposerStatus() {
  const busy = useUiStore((s) => s.chatBusy);
  return (
    <div
      className="opencanvas-composer-status"
      data-state={busy ? 'streaming' : 'idle'}
      aria-live="polite"
    >
      <Loader2 className="size-3 animate-spin" />
      OpenCanvas is thinking…
    </div>
  );
}
