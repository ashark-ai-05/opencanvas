import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, ExternalLink } from 'lucide-react';

/**
 * Inline notice for the most common first-run failure: the user typed a
 * real question before connecting any model, and the provider rejected
 * the call (missing / invalid key, Ollama not running). A raw
 * "SDK error: authentication_failed" toast reads like a crash; this
 * explains what happened, keeps the instant-widget path alive, and
 * gives one click to fix it.
 */
export function NoModelNotice({
  visible,
  onOpenSettings,
  onTry,
}: {
  visible: boolean;
  onOpenSettings: () => void;
  onTry: (text: string) => void;
}) {
  const chip = (t: string) => (
    <button
      key={t}
      type="button"
      onClick={() => onTry(t)}
      className="no-model-chip"
      style={{
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 11.5,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: '#e4e4e7',
        cursor: 'pointer',
      }}
    >
      {t}
    </button>
  );
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          data-testid="no-model-notice"
          initial={{ opacity: 0, y: 6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          role="status"
          aria-live="polite"
          style={{
            margin: '0 12px 8px',
            background:
              'linear-gradient(135deg, rgba(167, 139, 250, 0.12), rgba(45, 212, 191, 0.08))',
            border: '1px solid rgba(167, 139, 250, 0.34)',
            borderRadius: 10,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound className="size-4" style={{ color: '#a78bfa', flexShrink: 0 }} />
            <strong style={{ fontSize: 13, color: '#ede9fe' }}>No model connected yet</strong>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: '#d4d4d8' }}>
            The model rejected the request, usually because no API key is set. Paste one in
            Settings (Gemini has a free tier), or run Ollama for fully offline. These work
            right now with no model:
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['25 min focus', 'checklist: milk, eggs', '12 km in miles', 'standup tomorrow 9am'].map(chip)}
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
                background: 'rgba(167, 139, 250, 0.3)',
                border: '1px solid rgba(167, 139, 250, 0.6)',
                color: '#f5f3ff',
                cursor: 'pointer',
              }}
            >
              Connect a model
            </button>
            <a
              href="https://github.com/ashark-ai-05/opencanvas/blob/main/docs/guide.md#pick-a-model"
              target="_blank"
              rel="noreferrer noopener"
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                fontSize: 12,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#d4d4d8',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              Provider guide <ExternalLink className="size-3" />
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Does this chat error mean "no usable model credentials"? Matches the
 * provider error strings we actually see on a keyless first run.
 */
export function isNoModelError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  // The backend's own token guard is a different problem (see auth.ts).
  if (/X-OpenCanvas-Token/i.test(msg)) return false;
  return /authentication_failed|invalid[ _-]?api[ _-]?key|api key|x-api-key|unauthori[sz]ed|\b401\b|ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|not logged in|ECONNREFUSED[^\n]*11434/i.test(
    msg,
  );
}
