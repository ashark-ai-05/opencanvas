import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, LayoutGrid } from 'lucide-react';
import { TEMPLATES } from '../canvas/templates';
import { useTemplateStore } from '../state/template-store';

/**
 * Inline canvas-layout picker for the header.
 *
 * Trigger button shows the active template's name + a layout icon. Clicking
 * opens a small dropdown listing all 4 templates; the active one is checked
 * + role-tinted. Re-uses the dropdown shape from ChatOptionsMenu (portal +
 * computed coords) so it escapes any ancestor stacking context the header
 * might gain in the future.
 *
 * Replaces the prior absolute-positioned floating popover (rgba literals,
 * native <select>) — that variant was never mounted in App.tsx.
 */
export function TemplatePicker() {
  const activeId = useTemplateStore((s) => s.activeTemplateId);
  const setActive = useTemplateStore((s) => s.setActiveTemplateId);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const activeTemplate = TEMPLATES.find((t) => t.id === activeId) ?? TEMPLATES[0]!;

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({ top: rect.bottom + 6, left: rect.left });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="opencanvas-header-btn"
        title={`Layout: ${activeTemplate.name}`}
        aria-label="Canvas layout"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{ gap: 6, paddingInline: 8 }}
      >
        <LayoutGrid className="size-3.5" />
        <span style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: '-0.012em' }}>
          {activeTemplate.name}
        </span>
      </button>
      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              minWidth: 200,
              padding: 4,
              borderRadius: 10,
              background: 'rgb(var(--color-glass-rgb) / 0.96)',
              border: '1px solid var(--color-line-2)',
              backdropFilter: 'var(--blur-medium)',
              WebkitBackdropFilter: 'var(--blur-medium)',
              boxShadow: 'var(--depth-3-shadow)',
              zIndex: 60,
            }}
          >
            {TEMPLATES.map((t) => {
              const isActive = t.id === activeId;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActive(t.id);
                    setOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '7px 10px',
                    borderRadius: 6,
                    background: isActive ? 'rgba(167, 139, 250, 0.14)' : 'transparent',
                    border: 'none',
                    color: isActive ? 'var(--color-fg)' : 'var(--color-fg-2)',
                    fontSize: 13,
                    cursor: 'pointer',
                    textAlign: 'left',
                    gap: 12,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        'rgba(255,255,255,0.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }
                  }}
                >
                  <span>{t.name}</span>
                  {isActive && (
                    <Check className="size-3.5" style={{ color: 'var(--color-accent)' }} />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
