import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '../lib/motion/springs';
import { useParallax } from '../lib/motion/use-parallax';
import {
  ArrowRightCircle,
  LayoutGrid,
  MessageSquare,
  Pin,
  PinOff,
  Search,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { useConversationsStore } from '../state/conversations-store';
import { useTemplateStore } from '../state/template-store';
import { TEMPLATES_BY_ID } from '../canvas/templates';
import { COMMANDS, tryRunCommand } from './slash-commands';
import { getEditor } from '../state/editor-ref';
import { applyToolDirective } from '../canvas/dispatcher';
import { search as kbSearch, type SearchResult as KbHit } from '../api/search';

/**
 * Global Cmd/Ctrl+K palette. Surfaces conversations + canvas widgets
 * (current canvas) + slash commands + templates in a single ranked list.
 *
 * Why one palette, not four: keystroke → action is the unit. Users
 * remember "I had a table about X somewhere" but not "table widget
 * named X in conversation Y," and would rather not pick a category.
 *
 * Ranking is intentionally simple — substring match with a small
 * boost for prefix hits. Good enough at chat-volume scale; an FTS
 * over the conversation+widget corpus is a worthwhile follow-up.
 *
 * The palette is a portal-free overlay (z-index 50) so it sits above
 * the floating chat (30) and tldraw (which uses single-digit z's).
 */
type Result =
  | {
      kind: 'conversation';
      id: string;
      label: string;
      hint?: string;
    }
  | {
      kind: 'widget';
      shapeId: string;
      label: string;
      hint?: string;
    }
  | {
      /**
       * Widget on another conversation's canvas. Selecting jumps to
       * that conversation; once the canvas remounts we apply a focus
       * directive via applyToolDirective. The shape id is the raw
       * id from the saved snapshot (no 'shape:' prefix munging).
       */
      kind: 'remote-widget';
      conversationId: string;
      shapeId: string;
      label: string;
      hint?: string;
    }
  | {
      /**
       * Full-text hit from the KB (which includes indexed conversation
       * turns). Selecting opens the source URL in a new tab — the FTS
       * source is already an external link or a chunk reference.
       */
      kind: 'message';
      sourceId: string;
      uri?: string;
      label: string;
      hint?: string;
    }
  | {
      kind: 'command';
      name: string;
      label: string;
      hint?: string;
    }
  | {
      kind: 'template';
      id: string;
      label: string;
      hint?: string;
    };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const paletteParallax = useParallax({ maxTilt: 2, lift: false });

  // Cmd+K / Ctrl+K opens; Esc closes; '/' inside input is allowed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setCursor(0);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Auto-focus input on open.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Snapshot the live state at open-time (cheap; refresh per render).
  const conversations = useConversationsStore((s) => s.conversations);
  const activeId = useConversationsStore((s) => s.activeId);
  const selectOne = useConversationsStore((s) => s.selectOne);
  const setActiveTemplateId = useTemplateStore((s) => s.setActiveTemplateId);

  // Debounced full-text KB search. Fires when query has 4+ chars; the
  // /v1/index-conversation pipeline pushes assistant turns into the
  // KB so this also matches old conversation content. Results land
  // in `kbHits` which the memo below mixes into the unified result list.
  const [kbHits, setKbHits] = useState<KbHit[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 4) {
      setKbHits([]);
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      kbSearch(q, 6)
        .then((res) => {
          if (!cancelled) setKbHits(res.results);
        })
        .catch(() => {
          if (!cancelled) setKbHits([]);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const scored: Array<{ r: Result; score: number }> = [];

    // Conversations
    for (const c of conversations) {
      const label = c.title?.trim() || '(untitled)';
      const score = matchScore(label, q);
      if (score > 0) {
        scored.push({
          r: { kind: 'conversation', id: c.id, label, hint: c.id.slice(0, 8) },
          score: score + 0.05, // slight bias — most-used surface
        });
      }
    }

    // Current canvas widgets — title from props.title (or first markdown body).
    const editor = getEditor();
    if (editor) {
      const shapes = (editor.getCurrentPageShapes() as Array<{
        id: string;
        type: string;
        props: Record<string, unknown>;
      }>).filter((s) => s.type.startsWith('opencanvas:'));
      for (const s of shapes) {
        const title =
          (s.props['title'] as string | undefined) ??
          truncate(((s.props['body'] as string) ?? '').replace(/\s+/g, ' '), 40) ??
          s.type;
        const score = matchScore(title, q);
        if (score > 0) {
          scored.push({
            r: {
              kind: 'widget',
              shapeId: s.id,
              label: title,
              hint: s.type.replace(/^opencanvas:/, ''),
            },
            score,
          });
        }
      }
    }

    // Cross-canvas widgets — walk every other conversation's saved
    // canvasSnapshot so the user can find "that table about X" no
    // matter which conversation it lives in. Skip the active one
    // (the live editor walk above already covered it). The snapshot
    // store holds tldraw record maps; pull shapes out as plain objects.
    for (const c of conversations) {
      if (c.id === activeId) continue;
      const snap = c.canvasSnapshot;
      if (!snap) continue;
      // tldraw snapshot shape: { document: { store: Record<id, record> }, ... }.
      // Treat opaquely — we only walk records to find shapes.
      const recordsObj = snap as unknown as {
        document?: { store?: Record<string, unknown> };
        store?: Record<string, unknown>;
      };
      const records =
        recordsObj.document?.store ??
        recordsObj.store ??
        (snap as unknown as Record<string, unknown>);
      if (!records || typeof records !== 'object') continue;
      for (const id of Object.keys(records)) {
        const rec = (records as Record<string, unknown>)[id] as
          | { id?: string; type?: string; typeName?: string; props?: Record<string, unknown> }
          | undefined;
        if (!rec || typeof rec !== 'object') continue;
        if (rec.typeName !== 'shape') continue;
        if (typeof rec.type !== 'string' || !rec.type.startsWith('opencanvas:')) continue;
        const title =
          (rec.props?.['title'] as string | undefined) ??
          truncate(((rec.props?.['body'] as string) ?? '').replace(/\s+/g, ' '), 40) ??
          rec.type;
        const score = matchScore(title, q);
        if (score > 0) {
          scored.push({
            r: {
              kind: 'remote-widget',
              conversationId: c.id,
              shapeId: rec.id ?? id,
              label: title,
              hint: `in ${c.title?.trim() || '(untitled)'}`,
            },
            // Slight penalty so live-canvas widgets sort above remote
            // ones for the same query — switching conversations is
            // costlier than a focus jump.
            score: score - 0.04,
          });
        }
      }
    }

    // KB / message hits from the debounced backend search.
    for (const hit of kbHits) {
      const title =
        (hit.shape?.['title'] as string | undefined) ??
        (typeof hit.shape?.['body'] === 'string'
          ? truncate((hit.shape['body'] as string).replace(/\s+/g, ' '), 60)
          : null) ??
        hit.id;
      scored.push({
        r: {
          kind: 'message',
          sourceId: hit.sourceId,
          uri: hit.provenance?.uri,
          label: title,
          hint: hit.kind,
        },
        // KB hits sit just below conversation/widget matches but
        // above slash-commands/templates so semantic search shows
        // up where users expect.
        score: 0.9,
      });
    }

    // Slash commands (palette surfaces them so users can run /tidy etc
    // without remembering the slash).
    for (const c of COMMANDS) {
      const label = c.name;
      const haystack = `${c.name} ${c.description}`.toLowerCase();
      const score = matchScore(haystack, q) + matchScore(label, q) * 0.5;
      if (score > 0) {
        scored.push({
          r: { kind: 'command', name: c.name, label, hint: c.description },
          score,
        });
      }
    }

    // Templates
    for (const id of Object.keys(TEMPLATES_BY_ID)) {
      const tpl = TEMPLATES_BY_ID[id as keyof typeof TEMPLATES_BY_ID];
      const score = matchScore(`${id} ${tpl.name}`, q);
      if (score > 0) {
        scored.push({
          r: { kind: 'template', id, label: tpl.name, hint: id },
          score,
        });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((x) => x.r);
  }, [query, conversations, activeId, kbHits]);

  // Reset cursor when query changes.
  useEffect(() => {
    setCursor(0);
  }, [query]);

  const handleEnter = () => {
    const r = results[cursor];
    if (!r) return;
    runResult(r, { selectOne, setActiveTemplateId });
    setOpen(false);
  };

  if (!open) return null;
  return (
    <AnimatePresence>
      <motion.div
        key="cmdk-backdrop"
        className="opencanvas-cmdk-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        onClick={() => setOpen(false)}
      />
      <motion.div
        key="cmdk-panel"
        ref={paletteParallax.ref as React.RefObject<HTMLDivElement>}
        onPointerMove={paletteParallax.bind.onPointerMove}
        onPointerLeave={paletteParallax.bind.onPointerLeave}
        className="opencanvas-cmdk-panel"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={spring.firm}
        style={{
          rotateX: paletteParallax.rotateX,
          rotateY: paletteParallax.rotateY,
          transformPerspective: 1200,
        }}
        role="dialog"
        aria-modal="true"
      >
        <div className="opencanvas-cmdk-input-wrap">
          <Search className="size-4" style={{ color: 'var(--color-fg-2)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a conversation, widget, command, template…"
            className="opencanvas-cmdk-input"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, Math.max(0, results.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                handleEnter();
              }
            }}
          />
          <span className="opencanvas-cmdk-kbd">
            {results.length > 0 ? `${results.length}` : '–'}
          </span>
        </div>
        <div className="opencanvas-cmdk-list">
          {results.length === 0 && (
            <div className="opencanvas-cmdk-empty">
              <Sparkles className="size-3.5" style={{ color: '#c4b5fd' }} />
              {query.trim().length === 0
                ? 'Start typing — searches conversations, widgets on the current canvas, slash commands, and templates.'
                : 'No matches.'}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${rowKey(r)}-${i}`}
              type="button"
              className={
                'opencanvas-cmdk-row' +
                (i === cursor ? ' opencanvas-cmdk-row--active' : '')
              }
              onMouseEnter={() => setCursor(i)}
              onClick={() => {
                runResult(r, { selectOne, setActiveTemplateId });
                setOpen(false);
              }}
            >
              <span className="opencanvas-cmdk-icon">
                {r.kind === 'conversation' && <MessageSquare className="size-3.5" />}
                {r.kind === 'widget' && <Pin className="size-3.5" />}
                {r.kind === 'remote-widget' && <PinOff className="size-3.5" />}
                {r.kind === 'message' && <Search className="size-3.5" />}
                {r.kind === 'command' && <Terminal className="size-3.5" />}
                {r.kind === 'template' && <LayoutGrid className="size-3.5" />}
              </span>
              <span className="opencanvas-cmdk-label">{r.label}</span>
              {r.hint && <span className="opencanvas-cmdk-hint">{r.hint}</span>}
              {i === cursor && (
                <ArrowRightCircle
                  className="size-3.5 opencanvas-cmdk-go"
                  style={{ color: '#c4b5fd' }}
                />
              )}
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function runResult(
  r: Result,
  ctx: {
    selectOne: (id: string) => void;
    setActiveTemplateId: (id: never) => void;
  },
): void {
  if (r.kind === 'conversation') {
    ctx.selectOne(r.id);
    return;
  }
  if (r.kind === 'widget') {
    const editor = getEditor();
    if (!editor) return;
    const id = r.shapeId.replace(/^shape:/, '');
    applyToolDirective(
      editor,
      { type: 'focus', id },
      useTemplateStore.getState().activeTemplateId,
    );
    return;
  }
  if (r.kind === 'remote-widget') {
    // Switch conversations first, then focus the widget on the new
    // canvas. Canvas remounts on activeId change so we wait for the
    // editor singleton to flip; a short retry loop covers the worst
    // case where the new editor is still mounting.
    ctx.selectOne(r.conversationId);
    const targetId = r.shapeId.replace(/^shape:/, '');
    const tryFocus = (attempts: number) => {
      const editor = getEditor();
      if (!editor) {
        if (attempts > 0) setTimeout(() => tryFocus(attempts - 1), 80);
        return;
      }
      try {
        applyToolDirective(
          editor,
          { type: 'focus', id: targetId },
          useTemplateStore.getState().activeTemplateId,
        );
      } catch {
        // Shape might not be in the loaded snapshot yet; one more
        // retry covers tldraw's async hydration.
        if (attempts > 0) setTimeout(() => tryFocus(attempts - 1), 120);
      }
    };
    setTimeout(() => tryFocus(8), 50);
    return;
  }
  if (r.kind === 'message') {
    if (r.uri) window.open(r.uri, '_blank', 'noopener,noreferrer');
    return;
  }
  if (r.kind === 'command') {
    tryRunCommand('/' + r.name);
    return;
  }
  if (r.kind === 'template') {
    ctx.setActiveTemplateId(r.id as never);
    return;
  }
}

/**
 * Substring-match score: returns 0 when no match. Empty query matches
 * everything with score 1 (so the palette shows recents on open).
 * Prefix matches score higher than mid-string hits.
 */
function matchScore(haystack: string, query: string): number {
  if (!query) return 1;
  const h = haystack.toLowerCase();
  const i = h.indexOf(query);
  if (i < 0) return 0;
  // Prefix bias + length bias (shorter matches rank higher).
  return 1 + (i === 0 ? 1 : 0) + 1 / Math.max(1, h.length / 12);
}

/**
 * Stable React key for a result row — covers every variant of the
 * Result discriminated union without leaning on `'id' in r` runtime
 * checks that miss `kind: 'message'` (which has sourceId, not id).
 */
function rowKey(r: Result): string {
  switch (r.kind) {
    case 'conversation':
      return r.id;
    case 'widget':
      return r.shapeId;
    case 'remote-widget':
      return `${r.conversationId}:${r.shapeId}`;
    case 'message':
      return `msg:${r.sourceId}`;
    case 'command':
      return `cmd:${r.name}`;
    case 'template':
      return `tpl:${r.id}`;
  }
}

function truncate(s: string, max: number): string | undefined {
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
