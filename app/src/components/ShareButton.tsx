import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Copy, ExternalLink, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConversationsStore } from '../state/conversations-store';
import { getEditor } from '../state/editor-ref';

/**
 * Share button + result modal.
 *
 * The viral loop: a user has a cool agent moment → clicks Share →
 * the current canvas snapshot + chat transcript get POSTed to
 * `/v1/share` → backend returns a UUID → modal shows the public URL
 * the user can paste anywhere. Recipients open the URL and see a
 * read-only viewer of what the user built.
 *
 * Capture mechanism:
 *   - Canvas: `getEditor().getSnapshot()` (tldraw's serialized state)
 *   - Messages: conversations-store, scoped to the active conversation
 *   - Meta: a hint at the title (first user message, truncated) so
 *     /share/<id> can show a useful card on link previews later
 *
 * No auth required — anonymous shares are part of the public-demo UX.
 * Backend rate-limits creation at 10/hour per IP and caps payload size
 * at 256KB serialized.
 */
export function ShareButton({ activeId }: { activeId: string }) {
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setShareUrl(null);
    setCopied(false);

    try {
      const editor = getEditor();
      const snapshot = editor ? editor.getSnapshot() : null;
      const conv = useConversationsStore
        .getState()
        .conversations.find((c) => c.id === activeId);
      const messages = conv?.messages ?? [];

      if (!snapshot || messages.length === 0) {
        toast.error('Nothing to share yet — start a conversation first.');
        setCreating(false);
        return;
      }

      // Pluck a title hint from the first user message (truncated).
      // Falls back to the conversation's stored name when absent.
      const firstUserText = (() => {
        for (const m of messages) {
          if (m.role !== 'user') continue;
          const text = (m.parts as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text as string)
            .join('')
            .trim();
          if (text.length > 0) return text.slice(0, 120);
        }
        return conv?.name ?? 'Shared OpenCanvas';
      })();

      const res = await fetch('/v1/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          canvasSnapshot: snapshot,
          messages,
          meta: { title: firstUserText },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          hint?: string;
        };
        toast.error(
          body.hint ?? body.error ?? `Share failed (HTTP ${res.status})`,
        );
        setCreating(false);
        return;
      }
      const data = (await res.json()) as { id: string; url: string };
      const full = `${window.location.origin}/share/${data.id}`;
      setShareUrl(full);
      setOpen(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Share failed: ${message}`);
    } finally {
      setCreating(false);
    }
  }, [activeId, creating]);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy — select and copy manually.');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        disabled={creating}
        title="Share this canvas — produces a public read-only link"
        className="opencanvas-header-btn"
        aria-label="Share canvas"
      >
        {creating ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Share2 className="size-3.5" />
        )}
      </button>

      <AnimatePresence>
        {open && shareUrl && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.62)',
                backdropFilter: 'blur(4px)',
                zIndex: 50,
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 6 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="share-title"
              style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'min(520px, calc(100vw - 32px))',
                background: 'var(--color-bg-1, #0a0a0a)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 16,
                boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4)',
                zIndex: 51,
                padding: '22px 24px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Share2 className="size-4" style={{ color: '#a78bfa' }} />
                  <h2
                    id="share-title"
                    style={{
                      margin: 0,
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#fafafa',
                      letterSpacing: '-0.012em',
                    }}
                  >
                    Share link ready
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: 'transparent',
                    border: 'none',
                    color: '#a1a1aa',
                    cursor: 'pointer',
                  }}
                >
                  <X className="size-4" />
                </button>
              </div>

              <p
                style={{
                  margin: '0 0 16px',
                  fontSize: 12,
                  color: '#a1a1aa',
                  lineHeight: 1.55,
                }}
              >
                Anyone with this link can view your canvas + chat
                transcript — read-only. They can't reply or change
                anything. The link is unguessable; only people you
                share with can find it.
              </p>

              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'stretch',
                  marginBottom: 14,
                }}
              >
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#fafafa',
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  }}
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '0 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    background: copied
                      ? 'rgba(52, 211, 153, 0.18)'
                      : 'rgba(167, 139, 250, 0.22)',
                    border: copied
                      ? '1px solid rgba(52, 211, 153, 0.5)'
                      : '1px solid rgba(167, 139, 250, 0.5)',
                    color: copied ? '#a7f3d0' : '#ddd6fe',
                    cursor: 'pointer',
                  }}
                >
                  {copied ? (
                    <>
                      <Check className="size-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'flex-end',
                }}
              >
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#d4d4d8',
                    textDecoration: 'none',
                  }}
                >
                  Open link
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
