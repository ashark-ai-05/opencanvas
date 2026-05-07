import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Palette } from 'lucide-react';
import {
  THEMES,
  THEME_META,
  useThemeStore,
  type Theme,
} from '../state/theme-store';
import { HeaderIconButton } from './HeaderCanvasControls';

/**
 * Theme picker — popover anchored to a header button. Each row shows
 * a 3-swatch preview (background, surface, accent) so the user can
 * see at a glance what they're picking. Active theme has a check
 * mark. Click outside closes; Esc closes; selection auto-closes.
 *
 * Was a 2-state sun/moon toggle; now a 5-theme menu. The button
 * shows a palette icon since "sun" / "moon" are no longer the
 * binary axis (midnight / sunset are both dark, mono is grayscale).
 */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <HeaderIconButton
        title={`Theme: ${THEME_META[theme].label}`}
        onClick={() => setOpen((v) => !v)}
        pressed={open}
      >
        <Palette className="size-3.5" />
      </HeaderIconButton>
      <AnimatePresence>
        {open && (
          <motion.div
            className="opencanvas-theme-menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
            role="listbox"
            aria-label="Theme picker"
          >
            <div className="opencanvas-theme-menu-header">Theme</div>
            {THEMES.map((t) => (
              <ThemeRow
                key={t}
                value={t}
                active={t === theme}
                onPick={() => {
                  setTheme(t);
                  setOpen(false);
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThemeRow({
  value,
  active,
  onPick,
}: {
  value: Theme;
  active: boolean;
  onPick: () => void;
}) {
  const meta = THEME_META[value];
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={
        'opencanvas-theme-row' +
        (active ? ' opencanvas-theme-row--active' : '')
      }
      onClick={onPick}
    >
      <span className="opencanvas-theme-swatches" aria-hidden>
        {meta.swatches.map((c, i) => (
          <span key={i} style={{ background: c }} />
        ))}
      </span>
      <span className="opencanvas-theme-meta">
        <span className="opencanvas-theme-label">{meta.label}</span>
        <span className="opencanvas-theme-desc">{meta.description}</span>
      </span>
      {active && (
        <Check className="size-3.5 opencanvas-theme-check" aria-hidden />
      )}
    </button>
  );
}
