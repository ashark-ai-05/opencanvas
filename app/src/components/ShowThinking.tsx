import { useState, useEffect } from 'react';
import { Brain, ChevronRight, Loader2 } from 'lucide-react';

/**
 * Collapsible "Show thinking" block per assistant message.
 *
 * AI SDK v6 surfaces reasoning chunks as parts shaped:
 *   { type: 'reasoning', text: string, state?: 'streaming' | 'done' }
 *
 * We concatenate them (an assistant message can have multiple reasoning
 * parts), default to collapsed, and let the user open them on demand.
 * While the model is still emitting reasoning we show a small "thinking…"
 * affordance so the user knows there's more coming.
 */
export function ShowThinking({
  reasoningText,
  streaming,
}: {
  reasoningText: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);

  // While reasoning is streaming, keep the panel open so the user sees it
  // accumulate in real time. Once streaming finishes, leave the user's
  // current open/closed choice alone (don't snap closed under them).
  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  if (!reasoningText.trim()) return null;

  return (
    <div className="opencanvas-thinking">
      <button
        type="button"
        className="opencanvas-thinking-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="opencanvas-thinking-toggle-chevron">
          <ChevronRight className="size-3" />
        </span>
        <Brain className="size-3" style={{ color: 'var(--color-accent)' }} />
        <span>{open ? 'Hide thinking' : 'Show thinking'}</span>
        {streaming && (
          <span className="opencanvas-thinking-toggle-streaming">
            <Loader2 className="size-3 animate-spin" /> still reasoning…
          </span>
        )}
      </button>
      {open && <div className="opencanvas-thinking-body">{reasoningText}</div>}
    </div>
  );
}
