import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Copy, ExternalLink, X } from 'lucide-react';
import { toast } from 'sonner';
import { getEditor } from '../../state/editor-ref';

/**
 * Visual primitives for tldraw shapes. The actual styling lives in
 * `app/src/styles/globals.css` (.strata-card, .strata-card-header, etc.) so
 * the look-and-feel is changed in one place across all 5 widget kinds.
 *
 * Shapes pass `role` so the card picks up the right left-edge accent color
 * (primary=violet, detail=blue, related=teal, reference=amber, timeline=rose,
 *  node=emerald). Role lives in `shape.meta.role` (set by the dispatcher's
 *  place handler — see Plan 5 T28).
 */

type Role = 'primary' | 'detail' | 'related' | 'reference' | 'timeline' | 'node';

function readRole(meta: unknown): Role {
  if (typeof meta === 'object' && meta !== null && 'role' in meta) {
    const r = (meta as { role?: unknown }).role;
    if (
      r === 'primary' ||
      r === 'detail' ||
      r === 'related' ||
      r === 'reference' ||
      r === 'timeline' ||
      r === 'node'
    ) {
      return r;
    }
  }
  return 'primary';
}

/**
 * Outer card frame. Pass the shape so we can read role from meta and keep
 * the call sites of each ShapeUtil tidy.
 */
export function CardFrame({
  shape,
  children,
}: {
  shape: { props: { w: number; h: number }; meta?: unknown };
  children: ReactNode;
}) {
  const role = readRole(shape.meta);

  // "Freshly placed" pulse — runs once on mount, then we drop the attribute
  // so a re-render (e.g. resize) doesn't re-trigger the animation.
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFresh(false), 1200);
    return () => clearTimeout(t);
  }, []);

  const style: CSSProperties = { width: shape.props.w, height: shape.props.h };
  return (
    <div className="strata-card" data-role={role} data-fresh={fresh ? 'true' : 'false'} style={style}>
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div className="strata-card-header">{children}</div>;
}

export function CardBody({
  mono,
  children,
}: {
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={mono ? 'strata-card-body strata-card-body--mono' : 'strata-card-body'}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <span className="strata-card-title">{children}</span>;
}

export function Tag({
  children,
  accent = false,
}: {
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <span className={accent ? 'strata-tag strata-tag--accent' : 'strata-tag'}>{children}</span>
  );
}

// ---------- Card actions (hover affordances) ----------

/**
 * Small button rendered in a card's hover-action bar. `onClick` swallows
 * propagation so clicking the button doesn't also trigger tldraw's shape
 * select / drag handlers.
 */
export function CardActionButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  const handle = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  };
  return (
    <button
      type="button"
      onClick={handle}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title={title}
      aria-label={title}
      className="strata-card-action"
    >
      {children}
    </button>
  );
}

/**
 * Hover-only action bar. Renders any per-kind `extras` first, then a
 * default delete button that removes the shape from the editor.
 *
 * Each shape's component should add this to its CardHeader so users can
 * copy the body, open a URL, or remove the widget without diving into
 * tldraw's selection menu.
 */
export function CardActions({
  shapeId,
  extras,
}: {
  shapeId: string;
  extras?: ReactNode;
}) {
  const handleDelete = () => {
    const editor = getEditor();
    if (!editor) return;
    editor.deleteShapes([shapeId as never]);
  };

  return (
    <span className="strata-card-actions">
      {extras}
      <CardActionButton onClick={handleDelete} title="Remove this widget">
        <X className="size-3" />
      </CardActionButton>
    </span>
  );
}

/** Copy-to-clipboard action. Pretty much every kind wants one. */
export function CopyAction({ text, label }: { text: string; label?: string }) {
  return (
    <CardActionButton
      title={label ?? 'Copy contents'}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => toast(`Copied ${label ?? 'contents'}`))
          .catch(() => toast.error('Copy failed — clipboard permission?'));
      }}
    >
      <Copy className="size-3" />
    </CardActionButton>
  );
}

/** Open-URL action — visible on web-embed cards. */
export function OpenUrlAction({ url }: { url: string }) {
  return (
    <CardActionButton
      title={`Open ${url}`}
      onClick={() => {
        window.open(url, '_blank', 'noopener,noreferrer');
      }}
    >
      <ExternalLink className="size-3" />
    </CardActionButton>
  );
}
