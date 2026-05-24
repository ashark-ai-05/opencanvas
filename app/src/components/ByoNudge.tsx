import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';
import { useAnonUsage } from '../state/anon-usage-store';
import { useUserSettings } from '../state/user-settings-store';

/**
 * Soft signup-ish nudge that appears above the chat input after a
 * visitor has sent ~8 messages WITHOUT setting their own API key.
 * Reads from `anon-usage-store` (message counter) + `user-settings-store`
 * (BYO state). Dismissable; suppressed forever once the user configures
 * a key.
 *
 * Why "soft": the public demo is free anonymously. We don't want to
 * block — we want to gently route heavy users to BYO before they
 * exhaust the demo's shared rate limit. When per-user auth lands
 * later, this same component becomes the trigger for a real signup
 * wall (or a hybrid "sign up to keep chatting").
 */
export function ByoNudge({ onOpenSettings }: { onOpenSettings: () => void }) {
  const hasOverride = useUserSettings((s) => s.hasOverride());
  const dismissNudge = useAnonUsage((s) => s.dismissNudge);
  // Recompute on every render so dismissals + new messages re-evaluate.
  const visible = useAnonUsage((s) => s.shouldShowNudge(hasOverride));

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            margin: '0 12px 8px',
            background:
              'linear-gradient(135deg, rgba(167, 139, 250, 0.12), rgba(96, 165, 250, 0.08))',
            border: '1px solid rgba(167, 139, 250, 0.32)',
            borderRadius: 10,
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            overflow: 'hidden',
          }}
        >
          <Sparkles
            className="size-4"
            style={{ color: '#a78bfa', flexShrink: 0 }}
          />
          <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5, color: '#e4e4e7' }}>
            <strong style={{ color: '#fafafa' }}>Loving this?</strong>{' '}
            Bring your own API key to chat without hitting the demo's shared
            rate limit. Free tier keys from Google / Anthropic / Groq work great.
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(167, 139, 250, 0.28)',
              border: '1px solid rgba(167, 139, 250, 0.55)',
              color: '#ddd6fe',
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            BYO key
          </button>
          <button
            type="button"
            onClick={dismissNudge}
            aria-label="Dismiss"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              color: '#a1a1aa',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
