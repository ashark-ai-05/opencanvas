import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Search, LayoutGrid, Globe } from 'lucide-react';
import { useCanvasStats } from '../state/canvas-stats-store';

/**
 * Shown when the canvas has zero OpenCanvas widgets. Disappears with a fade as
 * soon as the first widget is placed. Positioned absolutely; doesn't block
 * canvas interactions (pointer-events: none everywhere except the chip itself).
 */
export function EmptyCanvasHint() {
  const widgetCount = useCanvasStats((s) => s.widgetCount);
  const visible = widgetCount === 0;

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
              <Sparkles className="size-3" style={{ color: '#c4b5fd' }} />
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
              The agent searches your KB, the web, and any configured MCP source —
              then assembles widgets here.
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
              <Suggestion icon={<Search className="size-3" />} label="Plan 5 architecture" />
              <Suggestion icon={<LayoutGrid className="size-3" />} label="Compare tldraw 3 features" />
              <Suggestion icon={<Globe className="size-3" />} label="What is the Gang of Four?" />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Suggestion({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 10px',
        borderRadius: 8,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        color: '#d4d4d8',
      }}
    >
      <span style={{ color: '#a78bfa' }}>{icon}</span>
      {label}
    </span>
  );
}
