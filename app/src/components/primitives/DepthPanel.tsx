import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '../../lib/motion/springs';

export interface DepthPanelProps {
  open: boolean;
  onClose: () => void;
  /** Side of viewport the panel slides in from. Default 'right'. */
  placement?: 'left' | 'right';
  /** Panel width as a CSS length. Default '380px'. */
  width?: string;
  /** Required for screen-reader announcements. */
  ariaLabel: string;
  children: ReactNode;
  /** Click outside the panel closes it. Default true. */
  closeOnBackdrop?: boolean;
  /** ESC closes the panel. Default true. */
  closeOnEscape?: boolean;
}

/**
 * Slide-in panel primitive — replaces the duplicated motion + glass
 * scaffold across ConversationsSidebar / SourcesPanel / McpSourcesPanel.
 *
 * Behavior:
 * - Backdrop fade in/out, click-to-close (configurable).
 * - ESC handler attached on mount, removed on unmount.
 * - Spring-physics slide animation from the placement edge.
 * - Focus trap via `inert` on #root while open (rendered via createPortal
 *   to document.body so the panel itself isn't inert).
 * - Restores focus to the trigger element on close.
 * - role="dialog" + aria-label for screen-reader semantics.
 *
 * Spec: docs/superpowers/specs/2026-05-09-modernise-ui-design.md
 */
export function DepthPanel({
  open,
  onClose,
  placement = 'right',
  width = '380px',
  ariaLabel,
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: DepthPanelProps) {
  const previousActiveRef = useRef<HTMLElement | null>(null);

  // ESC keydown handler — attached only while the panel is open.
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeOnEscape, onClose]);

  // Focus trap (via `inert` on app root) + focus restoration on close.
  // The panel is portaled to document.body so #root can be marked inert
  // without making the panel itself inert.
  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById('root');
    if (appRoot) appRoot.setAttribute('inert', '');

    return () => {
      if (appRoot) appRoot.removeAttribute('inert');
      // Restore focus to the trigger that opened us. Use a microtask
      // so React has finished its commit phase before we focus.
      const target = previousActiveRef.current;
      if (target && typeof target.focus === 'function') {
        queueMicrotask(() => target.focus());
      }
    };
  }, [open]);

  const slideFrom = placement === 'left' ? `-${width}` : width;

  // SSR safety — the createPortal target requires a DOM.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            data-testid="depth-panel-backdrop"
            className="opencanvas-panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={closeOnBackdrop ? onClose : undefined}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgb(0 0 0 / 0.40)',
              backdropFilter: 'blur(2px)',
              zIndex: 50,
            }}
          />
          <motion.aside
            role="dialog"
            aria-label={ariaLabel}
            data-placement={placement}
            className="opencanvas-panel glass-heavy"
            initial={{ x: slideFrom }}
            animate={{ x: 0 }}
            exit={{ x: slideFrom }}
            transition={spring.firm}
            style={{
              position: 'fixed',
              top: 0,
              bottom: 0,
              [placement]: 0,
              width,
              boxShadow: 'var(--depth-3-shadow)',
              zIndex: 51,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
