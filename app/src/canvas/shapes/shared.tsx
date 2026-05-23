import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useParallax } from '../../lib/motion/use-parallax';
import { ChevronDown, Copy, ExternalLink, Pin, PinOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { getEditor } from '../../state/editor-ref';
import { SendWidgetMenu } from '../../components/SendWidgetMenu';

/**
 * Header height when a card is collapsed. Should match the rendered
 * `.opencanvas-card-header` height in globals.css (padding 11+9 + ~22 line + 1
 * border-bottom = ~43px). Rounded up for safety so nothing visually clips.
 */
const COLLAPSED_HEIGHT = 44;

/**
 * Visual primitives for tldraw shapes. The actual styling lives in
 * `app/src/styles/globals.css` (.opencanvas-card, .opencanvas-card-header, etc.) so
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

function readCollapsed(meta: unknown): boolean {
  if (typeof meta === 'object' && meta !== null && 'collapsed' in meta) {
    return (meta as { collapsed?: unknown }).collapsed === true;
  }
  return false;
}

/**
 * Streaming state from meta, used by streaming-aware shapes (generic) to
 * gate caret/skeleton/border-pulse visuals. Returns:
 *   { active: true }   — stream is currently producing ops
 *   { active: false, error: string } — stream ended with ok=false
 *   { active: false }  — stream finished (ok=true) OR never started
 */
export function readStreaming(
  meta: unknown,
): { active: boolean; error?: string } {
  if (!meta || typeof meta !== 'object') return { active: false };
  const m = meta as { streaming?: unknown; streamingError?: unknown };
  const active = m.streaming === true;
  if (active) return { active: true };
  if (typeof m.streamingError === 'string') {
    return { active: false, error: m.streamingError };
  }
  return { active: false };
}

/**
 * A single attribution entry — either a bare URL string or a {url, label?}.
 */
export type SourcePill = string | { url: string; label?: string };

/**
 * Outer card frame. Pass the shape so we can read role from meta and keep
 * the call sites of each ShapeUtil tidy.
 *
 * Attribution: the spec lets every payload carry both a single canonical
 * `source: string` (typed in via the body URL pill) AND a `sources` array
 * of clickable footer pills for multi-attribution. Both render side-by-side
 * when present; web-embed suppresses the single-source footer because the
 * URL is already prominent in the body.
 */
/**
 * Module-scope set of shape ids that have already played their fresh-
 * placement pulse. tldraw virtualises shapes that scroll off-screen
 * and re-mounts them on return; without this, the pulse re-fires
 * every time the shape comes back into view (the visible "flakiness"
 * — cards appear to flash on scroll). Shape ids are unique-per-canvas
 * so we never over-suppress.
 */
const PULSED_SHAPE_IDS = new Set<string>();

export function CardFrame({
  shape,
  children,
}: {
  shape: {
    id: string;
    props: {
      w: number;
      h: number;
      source?: string;
      sources?: SourcePill[];
      url?: string;
    };
    meta?: unknown;
  };
  children: ReactNode;
}) {
  const role = readRole(shape.meta);
  const collapsed = readCollapsed(shape.meta);

  // "Freshly placed" pulse — only on the very first mount of a shape,
  // identified by its id. Re-mounts (tldraw virtualisation, dev HMR)
  // skip the pulse so cards don't strobe on scroll.
  const [fresh, setFresh] = useState(() => !PULSED_SHAPE_IDS.has(shape.id));
  useEffect(() => {
    if (!fresh) return undefined;
    PULSED_SHAPE_IDS.add(shape.id);
    const t = setTimeout(() => setFresh(false), 1200);
    return () => clearTimeout(t);
  }, [fresh, shape.id]);

  const { ref, rotateX, rotateY, translateZ, bind, isActive } = useParallax({ maxTilt: 3 });

  const style: CSSProperties = { width: shape.props.w, height: shape.props.h };
  const sources = Array.isArray(shape.props.sources)
    ? shape.props.sources
    : undefined;
  const showSingleSource =
    typeof shape.props.source === 'string' &&
    shape.props.source.length > 0 &&
    !shape.props.url;

  // Gate the 3D transform style on isActive — when the card isn't being
  // hovered, render WITHOUT rotateX/Y/perspective so text rasterizes via
  // CPU subpixel hinting (3D-transformed layers texture-rasterize, ~5–10%
  // softer text). isActive remains true through pointer-leave + spring
  // settle, so the card doesn't snap mid-animation when the cursor leaves.
  const activeStyle = isActive
    ? ({
        ...style,
        rotateX,
        rotateY,
        z: translateZ,
        transformPerspective: 1200,
      } as CSSProperties)
    : style;

  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      {...bind}
      className="opencanvas-card"
      data-role={role}
      data-fresh={fresh ? 'true' : 'false'}
      data-collapsed={collapsed ? 'true' : 'false'}
      style={activeStyle}
    >
      {children}
      {showSingleSource && <CardSourceFooter source={shape.props.source!} />}
      {sources && sources.length > 0 && <CardSourcesFooter sources={sources} />}
    </motion.div>
  );
}

/**
 * Attribution row at the bottom of a card. If the source looks like a URL,
 * render as an external-open link; otherwise render as plain text. Either
 * way, hidden when the card is collapsed (the [data-collapsed] CSS does it).
 */
function CardSourceFooter({ source }: { source: string }) {
  const isUrl = /^https?:\/\//.test(source);
  const handleClick = (e: MouseEvent) => {
    if (!isUrl) return;
    e.stopPropagation();
    window.open(source, '_blank', 'noopener,noreferrer');
  };
  return (
    <div
      className="opencanvas-card-footer"
      onClick={handleClick}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ cursor: isUrl ? 'pointer' : 'default' }}
      title={isUrl ? `Open ${source}` : `Source: ${source}`}
    >
      <span className="opencanvas-card-footer-label">source</span>
      <span className="opencanvas-card-footer-value">
        {isUrl ? new URL(source).host + new URL(source).pathname : source}
      </span>
      {isUrl && <ExternalLink className="size-3 opacity-60" />}
    </div>
  );
}

/**
 * Render the `sources[]` array as a row of clickable pills. Each entry can
 * be either a bare URL or a `{url, label?}` — we show `label` when present
 * and fall back to the URL host. Hidden when the card is collapsed via
 * the [data-collapsed] CSS rules in globals.css.
 */
function CardSourcesFooter({ sources }: { sources: SourcePill[] }) {
  return (
    <div
      className="opencanvas-card-footer opencanvas-card-footer--multi"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="opencanvas-card-footer-label">sources</span>
      <span className="opencanvas-card-footer-pills">
        {sources.map((s, i) => {
          const url = typeof s === 'string' ? s : s.url;
          const label =
            typeof s === 'string' ? labelFromUrl(url) : (s.label ?? labelFromUrl(url));
          return (
            <a
              key={`${url}-${i}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="opencanvas-card-footer-pill"
              title={url}
              onClick={(e) => e.stopPropagation()}
            >
              {label}
              <ExternalLink className="size-3 opacity-60" />
            </a>
          );
        })}
      </span>
    </div>
  );
}

function labelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div className="opencanvas-card-header">{children}</div>;
}

export function CardBody({
  mono,
  children,
}: {
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={mono ? 'opencanvas-card-body opencanvas-card-body--mono' : 'opencanvas-card-body'}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <span className="opencanvas-card-title">{children}</span>;
}

export function Tag({
  children,
  accent = false,
}: {
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <span className={accent ? 'opencanvas-tag opencanvas-tag--accent' : 'opencanvas-tag'}>{children}</span>
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
      className="opencanvas-card-action"
    >
      {children}
    </button>
  );
}

/**
 * Hover-only action bar. Renders any per-kind `extras`, then default
 * collapse-toggle + delete buttons. Take the whole shape so we can
 * derive id + collapsed state from one place.
 */
export function CardActions({
  shape,
  extras,
}: {
  shape: { id: string; type?: string; meta?: unknown };
  extras?: ReactNode;
}) {
  const collapsed = readCollapsed(shape.meta);
  const pinned = readPinned(shape.meta);

  const handleDelete = () => {
    const editor = getEditor();
    if (!editor) return;
    editor.deleteShapes([shape.id as never]);
  };

  const togglePin = () => {
    const editor = getEditor();
    if (!editor) return;
    const cur = editor.getShape(shape.id as never) as
      | { type: string; meta?: Record<string, unknown> }
      | undefined;
    if (!cur) return;
    const meta = { ...(cur.meta ?? {}) };
    const willBePinned = !pinned;
    if (pinned) {
      delete (meta as { pinned?: unknown }).pinned;
    } else {
      meta['pinned'] = true;
    }
    editor.updateShape({
      id: shape.id as never,
      type: cur.type as never,
      meta: meta as never,
    } as never);
    // Record the pin signal in the preferences store. Only counted
    // on the pin direction (not on unpin) — the gesture we care about
    // is "user actively decided this is worth keeping." Lazy-imported
    // to avoid a top-level circular dep with state/conversations-store.
    if (willBePinned && shape.type) {
      const kind = shape.type.replace(/^opencanvas:/, '');
      void import('../../state/preferences-store').then((m) => {
        void import('../../state/conversations-store').then((c) => {
          const conv = c.useConversationsStore.getState().activeId;
          if (conv) m.usePreferences.getState().record(conv, kind, 'pinned');
        });
      });
    }
  };

  return (
    <span className="opencanvas-card-actions">
      {extras}
      <SendWidgetMenu shapeId={shape.id} />
      <CardActionButton
        onClick={togglePin}
        title={pinned ? 'Unpin (will be removed by Clear)' : 'Pin (survives Clear)'}
      >
        {pinned ? (
          <Pin className="size-3" style={{ color: '#fbbf24' }} />
        ) : (
          <PinOff className="size-3" />
        )}
      </CardActionButton>
      <ToggleCollapsedAction shapeId={shape.id} collapsed={collapsed} />
      <CardActionButton onClick={handleDelete} title="Remove this widget">
        <X className="size-3" />
      </CardActionButton>
    </span>
  );
}

/** Read meta.pinned defensively. Pinned shapes survive 'clear'. */
function readPinned(meta: unknown): boolean {
  if (typeof meta === 'object' && meta !== null && 'pinned' in meta) {
    return (meta as { pinned?: unknown }).pinned === true;
  }
  return false;
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

/**
 * Collapse / expand toggle. Stores the pre-collapse height in
 * `meta.expandedHeight` so we can restore it cleanly. Updates `props.h`
 * so tldraw's geometry (selection bounds, hit-testing, snap-to) matches
 * the visible card.
 */
export function ToggleCollapsedAction({
  shapeId,
  collapsed,
}: {
  shapeId: string;
  collapsed: boolean;
}) {
  return (
    <CardActionButton
      title={collapsed ? 'Expand' : 'Collapse'}
      onClick={() => {
        const editor = getEditor();
        if (!editor) return;
        const shape = editor.getShape(shapeId as never) as
          | { type: string; props: { h: number }; meta?: { expandedHeight?: number } }
          | undefined;
        if (!shape) return;
        const meta = (shape.meta ?? {}) as {
          expandedHeight?: number;
          collapsed?: boolean;
        };
        if (collapsed) {
          editor.updateShape({
            id: shapeId as never,
            type: shape.type as never,
            props: { h: meta.expandedHeight ?? 200 } as never,
            meta: { ...meta, collapsed: false },
          } as never);
        } else {
          editor.updateShape({
            id: shapeId as never,
            type: shape.type as never,
            props: { h: COLLAPSED_HEIGHT } as never,
            meta: {
              ...meta,
              collapsed: true,
              expandedHeight: shape.props.h,
            },
          } as never);
        }
      }}
    >
      <ChevronDown
        className="size-3"
        style={{
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          transition: 'transform 160ms ease',
        }}
      />
    </CardActionButton>
  );
}
