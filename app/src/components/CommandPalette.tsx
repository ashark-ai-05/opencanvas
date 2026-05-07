import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRightCircle,
  LayoutGrid,
  MessageSquare,
  Pin,
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
  const selectOne = useConversationsStore((s) => s.selectOne);
  const setActiveTemplateId = useTemplateStore((s) => s.setActiveTemplateId);

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
  }, [query, conversations]);

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
        className="opencanvas-cmdk-panel"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
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
              key={`${r.kind}-${'id' in r ? r.id : 'name' in r ? r.name : r.shapeId}-${i}`}
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

function truncate(s: string, max: number): string | undefined {
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
