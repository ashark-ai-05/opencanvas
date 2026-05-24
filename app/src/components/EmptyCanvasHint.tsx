import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Timer, LayoutGrid, BookOpen } from 'lucide-react';
import { useEditor, useValue } from 'tldraw';
import { useChatActions } from '../state/chat-actions-store';

/**
 * Shown when the canvas has zero shapes — any shape (widget OR a
 * native draw/arrow/geo stroke) hides it. Previously gated on
 * opencanvas-widget count only, so the banner stuck around while the
 * user was actively drawing. Positioned absolutely; doesn't block
 * canvas interactions (pointer-events: none everywhere except the chip itself).
 */
export function EmptyCanvasHint() {
  const editor = useEditor();
  const sendChat = useChatActions((s) => s.sendChat);
  const shapeCount = useValue(
    'canvas shape count',
    () => editor.getCurrentPageShapes().length,
    [editor],
  );
  const visible = shapeCount === 0;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <div
            className="opencanvas-glass"
            style={{
              padding: '20px 24px',
              borderRadius: 16,
              maxWidth: 480,
              textAlign: 'center',
              pointerEvents: 'auto',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                borderRadius: 999,
                background: 'rgba(167, 139, 250, 0.12)',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                marginBottom: 12,
              }}
            >
              <motion.span
                aria-hidden
                style={{ display: 'inline-flex', color: '#c4b5fd' }}
                animate={{
                  rotate: [0, -10, 8, 0],
                  scale: [1, 1.18, 0.92, 1],
                  filter: [
                    'drop-shadow(0 0 0 rgba(196,181,253,0))',
                    'drop-shadow(0 0 6px rgba(196,181,253,0.7))',
                    'drop-shadow(0 0 0 rgba(196,181,253,0))',
                  ],
                }}
                transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkles className="size-3" />
              </motion.span>
              <span style={{ fontSize: 11, color: '#c4b5fd', letterSpacing: 0.02 }}>
                empty canvas
              </span>
            </div>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: '-0.012em',
                color: '#fafafa',
              }}
            >
              Ask OpenCanvas to build your view
            </h2>
            <p
              style={{
                margin: '6px 0 14px',
                fontSize: 13,
                color: '#a1a1aa',
                lineHeight: 1.55,
              }}
            >
              Ask anything — the agent renders widgets on this canvas as it
              answers. Try one of these to see how it works:
            </p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                justifyContent: 'center',
                fontSize: 12,
              }}
            >
              <Suggestion
                icon={<Timer className="size-3" />}
                label="Build a Pomodoro timer"
                prompt="Build a Pomodoro timer widget with a 25 minute focus block and a 5 minute break."
                onClick={sendChat}
              />
              <Suggestion
                icon={<LayoutGrid className="size-3" />}
                label="Compare React vs Vue"
                prompt="Compare React and Vue in a table — covering rendering model, state management, ecosystem, and learning curve."
                onClick={sendChat}
              />
              <Suggestion
                icon={<BookOpen className="size-3" />}
                label="Explain CAP theorem"
                prompt="Explain the CAP theorem with concrete examples of CP, AP, and CA systems."
                onClick={sendChat}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Suggestion({
  icon,
  label,
  prompt,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  prompt: string;
  onClick: ((prompt: string) => void) | null;
}) {
  const handleClick = () => {
    if (onClick) onClick(prompt);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!onClick}
      title={prompt}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        borderRadius: 8,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        color: '#d4d4d8',
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
      }}
    >
      <span style={{ color: '#a78bfa' }}>{icon}</span>
      {label}
    </button>
  );
}
