import { motion, AnimatePresence } from 'framer-motion';
import { Zap, ExternalLink } from 'lucide-react';

/**
 * Inline notice that surfaces ONLY when the backend returns the
 * structured 503 "demo at capacity" payload (see chat-semaphore.ts).
 * Converts the capacity wall into a one-click jump to the BYO settings
 * modal — the demo's actual sustainable usage model.
 *
 * Visually parallel to ByoNudge but urgent (amber, not purple) and
 * non-dismissible — it auto-hides when `visible` flips back to false,
 * which the parent does on the next successful turn.
 */
export function ChatCapacityNotice({
  visible,
  onOpenSettings,
}: {
  visible: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          role="status"
          aria-live="polite"
          style={{
            margin: '0 12px 8px',
            background:
              'linear-gradient(135deg, rgba(251, 191, 36, 0.14), rgba(249, 115, 22, 0.10))',
            border: '1px solid rgba(251, 191, 36, 0.38)',
            borderRadius: 10,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap
              className="size-4"
              style={{ color: '#fbbf24', flexShrink: 0 }}
            />
            <strong style={{ fontSize: 13, color: '#fef3c7' }}>
              Demo is at capacity right now
            </strong>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: '#fde68a' }}>
            We're getting hammered (hi HN&nbsp;👋). Add your own free Gemini key
            and keep going — takes about 60 seconds.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onOpenSettings}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                background: 'rgba(251, 191, 36, 0.34)',
                border: '1px solid rgba(251, 191, 36, 0.62)',
                color: '#fef3c7',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Paste my key
            </button>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer noopener"
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
                background: 'transparent',
                border: '1px solid rgba(251, 191, 36, 0.32)',
                color: '#fcd34d',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              Get a free key
              <ExternalLink className="size-3" />
            </a>
            <a
              href="https://github.com/ashark-ai-05/opencanvas#install"
              target="_blank"
              rel="noreferrer noopener"
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#d4d4d8',
                textDecoration: 'none',
              }}
            >
              or self-host →
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Heuristic: does this error indicate the backend returned the
 * structured CHAT_CAPACITY_EXCEEDED 503? The AI SDK transport bubbles
 * non-2xx response bodies into Error.message, so the marker code
 * appears verbatim. Sentinel string is the contract between
 * chat-semaphore.ts and this component — change in lockstep.
 */
export function isCapacityError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('CHAT_CAPACITY_EXCEEDED');
}
