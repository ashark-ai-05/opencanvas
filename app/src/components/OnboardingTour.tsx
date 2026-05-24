import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Sparkles, X } from 'lucide-react';

/**
 * First-visit onboarding tour — a compact 3-step popover that teaches
 * the UI surface without dimming the canvas or stealing focus.
 *
 * Step contents (kept short — every word costs attention):
 *   1. "Welcome" — what the canvas does + a pointer to the chat
 *   2. "Ask anything" — example prompt + how widgets appear
 *   3. "BYO key" — the gear icon, free-tier alternatives
 *
 * Persistence:
 *   localStorage key `opencanvas:onboarding-tour:v1` — set to '1'
 *   after the tour completes (Got it) or is dismissed (X). Never
 *   re-shows once dismissed; re-shows after a clear-storage reset.
 *
 * Why a popover (not a fullscreen spotlight): a spotlight that
 * tracks DOM targets is fragile (responsive layout shifts the
 * coordinates, the camera moves, the panel resizes). A docked
 * popover that POINTS at things via arrows + verb-y copy is more
 * robust and feels lighter — the visitor's first 30 seconds shouldn't
 * be a blocking tutorial.
 *
 * Order with the welcome widgets:
 *   The welcome widgets render in `<Canvas onMount>` via a
 *   queueMicrotask. The tour mounts immediately on App render. By
 *   the time the visitor reads step 1 (~3 seconds), the welcome
 *   widgets are already on the canvas — so step 2's "watch widgets
 *   appear" claim is supported by what's visible in the background.
 */
const FLAG_KEY = 'opencanvas:onboarding-tour:v1';

interface Step {
  title: string;
  body: string;
  hint?: string;
}

const STEPS: Step[] = [
  {
    title: '👋 Welcome to OpenCanvas',
    body:
      "Talk to an AI on an infinite canvas. Whatever you ask, the agent renders typed widgets in the background — charts, diagrams, code, kanbans, anything.",
    hint: 'The three widgets visible are samples — drag them around or delete them.',
  },
  {
    title: '✨ Ask anything',
    body:
      "Type in the chat (bottom right). The agent will place widgets on the canvas as it answers. Try \"Build a Pomodoro timer\" or \"Show me a flowchart for OAuth\".",
    hint: 'Click the mic icon to speak instead of typing.',
  },
  {
    title: '🔑 Bring your own model',
    body:
      "The public demo uses a shared free-tier key — rate-limited across all visitors. Click the gear icon in the header to plug in your own key (Google / Anthropic / OpenAI / Groq / Ollama — most have free tiers).",
    hint: 'Your key stays in your browser. We never see it.',
  },
];

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Defer the first-paint check by a tick so the canvas + welcome
    // widgets land first (the tour feels right when the canvas is
    // already populated behind it). Skipping the timeout when local
    // storage is unavailable.
    try {
      if (typeof localStorage === 'undefined') return;
      if (localStorage.getItem(FLAG_KEY)) return;
      const t = setTimeout(() => setOpen(true), 900);
      return () => clearTimeout(t);
    } catch {
      /* private browsing — skip */
    }
  }, []);

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(FLAG_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  };

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const current = STEPS[step]!;

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
          role="dialog"
          aria-label="OpenCanvas onboarding tour"
          aria-modal="false"
          style={{
            position: 'fixed',
            bottom: 24,
            left: 24,
            zIndex: 40,
            width: 'min(360px, calc(100vw - 48px))',
            background: 'rgba(10, 10, 10, 0.95)',
            border: '1px solid rgba(167, 139, 250, 0.32)',
            borderRadius: 14,
            padding: '16px 18px 14px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                fontWeight: 600,
                color: '#a78bfa',
                textTransform: 'uppercase',
                letterSpacing: 0.12,
              }}
            >
              <Sparkles className="size-3" />
              <span>Step {step + 1} of {STEPS.length}</span>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss tour"
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
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Animated content swap on step change */}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <h3
                style={{
                  margin: '4px 0 6px',
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fafafa',
                  letterSpacing: '-0.012em',
                }}
              >
                {current.title}
              </h3>
              <p
                style={{
                  margin: '0 0 6px',
                  fontSize: 13,
                  color: '#d4d4d8',
                  lineHeight: 1.55,
                }}
              >
                {current.body}
              </p>
              {current.hint && (
                <p
                  style={{
                    margin: '0 0 12px',
                    fontSize: 11,
                    color: '#a1a1aa',
                    lineHeight: 1.5,
                    fontStyle: 'italic',
                  }}
                >
                  {current.hint}
                </p>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Footer: dot indicators + Next button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 4,
            }}
          >
            <div style={{ display: 'inline-flex', gap: 4 }}>
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  aria-hidden
                  style={{
                    width: i === step ? 18 : 6,
                    height: 6,
                    borderRadius: 99,
                    background: i === step
                      ? '#a78bfa'
                      : 'rgba(255, 255, 255, 0.15)',
                    transition: 'all 220ms ease',
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={next}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                background: 'rgba(167, 139, 250, 0.28)',
                border: '1px solid rgba(167, 139, 250, 0.55)',
                color: '#ddd6fe',
                cursor: 'pointer',
              }}
            >
              {step < STEPS.length - 1 ? (
                <>
                  Next
                  <ArrowRight className="size-3" />
                </>
              ) : (
                'Got it'
              )}
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
