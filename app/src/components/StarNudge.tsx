import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Github, X } from 'lucide-react';
import {
  useStarNudge,
  STAR_NUDGE_EVENT,
  STAR_REPO_URL,
} from '../state/star-nudge-store';
import { useAnonUsage } from '../state/anon-usage-store';
import { useUserSettings } from '../state/user-settings-store';

/**
 * Tasteful once-per-browser CTA after a strong no-key moment (first
 * auto-tidy) or a successful share. Links to the public GitHub repo.
 * Visually quieter than ByoNudge — a thin bar, not a signup pitch.
 */
export function StarNudge() {
  const visible = useStarNudge((s) => s.visible);
  const offer = useStarNudge((s) => s.offer);
  const dismiss = useStarNudge((s) => s.dismiss);
  const starred = useStarNudge((s) => s.starred);
  const hasOverride = useUserSettings((s) => s.hasOverride());
  const byoVisible = useAnonUsage((s) => s.shouldShowNudge(hasOverride));
  const show = visible && !byoVisible;

  useEffect(() => {
    const onOffer = () => offer();
    window.addEventListener(STAR_NUDGE_EVENT, onOffer);
    return () => window.removeEventListener(STAR_NUDGE_EVENT, onOffer);
  }, [offer]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            margin: '0 12px 8px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 10,
            padding: '9px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            overflow: 'hidden',
          }}
        >
          <Github
            className="size-3.5"
            style={{ color: '#a1a1aa', flexShrink: 0 }}
          />
          <div style={{ flex: 1, fontSize: 12, lineHeight: 1.45, color: '#a1a1aa' }}>
            If OpenCanvas saved you a keystroke, a star on GitHub helps others find it.
          </div>
          <a
            href={STAR_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => starred()}
            style={{
              padding: '5px 11px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              color: '#e4e4e7',
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              textDecoration: 'none',
            }}
          >
            ★ Star
          </a>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              color: '#71717a',
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
