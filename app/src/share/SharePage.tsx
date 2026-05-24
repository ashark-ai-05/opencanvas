import { useEffect, useState } from 'react';
import { Loader2, Sparkles, ExternalLink, AlertCircle } from 'lucide-react';

/**
 * `/share/<id>` — public read-only viewer for a snapshot a user
 * created via the Share button.
 *
 * Renders:
 *   - The conversation transcript (user + assistant turns)
 *   - A widget gallery summarising what was on the canvas
 *   - A "Try OpenCanvas yourself" CTA pointing at the demo home page
 *
 * Deliberately NOT a full tldraw rehydrate (yet) — that would require
 * lifting half the canvas pipeline outside its conversation context.
 * v1 is the simple transcript-plus-widget-cards view; we can add a
 * spatial-canvas view as a `?view=canvas` query later.
 *
 * State machine:
 *   loading → ok | not_found | error
 *
 * No auth, no chat input — the page is purely a view.
 */

interface ShareApiResponse {
  ok: boolean;
  id: string;
  createdAt: number;
  viewCount: number;
  data: {
    canvasSnapshot: unknown;
    messages: ShareMessage[];
    meta?: { title?: string; [k: string]: unknown };
  };
}

interface ShareMessage {
  role: 'user' | 'assistant' | string;
  parts?: Array<{
    type: string;
    text?: string;
    output?: unknown;
    toolName?: string;
    [k: string]: unknown;
  }>;
}

type State =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; data: ShareApiResponse };

export function SharePage({ shareId }: { shareId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/v1/share/${encodeURIComponent(shareId)}`);
        if (res.status === 404) {
          if (!cancelled) setState({ kind: 'not_found' });
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setState({
              kind: 'error',
              message: `Backend returned HTTP ${res.status}`,
            });
          }
          return;
        }
        const data = (await res.json()) as ShareApiResponse;
        if (!cancelled) setState({ kind: 'ok', data });
      } catch (e) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #0a0a0a 0%, #0f0d1a 100%)',
        color: '#fafafa',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <ShareHeader />
      <main style={{ maxWidth: 920, margin: '0 auto', padding: '32px 24px 64px' }}>
        {state.kind === 'loading' && <LoadingBlock />}
        {state.kind === 'not_found' && <NotFoundBlock />}
        {state.kind === 'error' && <ErrorBlock message={state.message} />}
        {state.kind === 'ok' && <ShareContent data={state.data} />}
      </main>
    </div>
  );
}

function ShareHeader() {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 24px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        background: 'rgba(10, 10, 10, 0.85)',
        backdropFilter: 'blur(8px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Sparkles className="size-4" style={{ color: '#a78bfa' }} />
        <strong style={{ fontSize: 14, letterSpacing: '-0.012em' }}>OpenCanvas</strong>
        <span style={{ fontSize: 11, color: '#71717a' }}>· shared canvas</span>
      </div>
      <a
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 500,
          background: 'rgba(167, 139, 250, 0.22)',
          border: '1px solid rgba(167, 139, 250, 0.5)',
          color: '#ddd6fe',
          textDecoration: 'none',
        }}
      >
        Try OpenCanvas yourself
        <ExternalLink className="size-3" />
      </a>
    </header>
  );
}

function LoadingBlock() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '120px 0',
        color: '#a1a1aa',
        fontSize: 13,
      }}
    >
      <Loader2 className="size-4 animate-spin" style={{ marginRight: 8 }} />
      Loading shared canvas…
    </div>
  );
}

function NotFoundBlock() {
  return (
    <div
      style={{
        padding: '64px 32px',
        textAlign: 'center',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 16,
      }}
    >
      <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 600 }}>
        Share not found
      </h1>
      <p style={{ margin: 0, color: '#a1a1aa', fontSize: 14 }}>
        This link may have been mistyped or removed. Head to{' '}
        <a href="/" style={{ color: '#a78bfa' }}>
          the home page
        </a>{' '}
        to start your own canvas.
      </p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '20px 24px',
        background: 'rgba(248, 113, 113, 0.08)',
        border: '1px solid rgba(248, 113, 113, 0.3)',
        borderRadius: 12,
        color: '#fca5a5',
        fontSize: 13,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      }}
    >
      <AlertCircle className="size-4" style={{ marginTop: 2, flexShrink: 0 }} />
      <div>
        <div style={{ fontWeight: 600, marginBottom: 4, fontFamily: 'Inter, sans-serif' }}>
          Couldn't load this share
        </div>
        <div>{message}</div>
      </div>
    </div>
  );
}

function ShareContent({ data }: { data: ShareApiResponse }) {
  const created = new Date(data.createdAt);
  const title =
    typeof data.data.meta?.title === 'string'
      ? data.data.meta.title
      : 'Shared canvas';

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            margin: '0 0 6px',
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: 0,
            color: '#71717a',
            fontSize: 12,
          }}
        >
          shared {timeAgo(created)} · {data.viewCount}{' '}
          {data.viewCount === 1 ? 'view' : 'views'}
        </p>
      </div>

      <Transcript messages={data.data.messages} />
      <WidgetSummary
        canvasSnapshot={data.data.canvasSnapshot as Record<string, unknown> | null}
      />

      <div
        style={{
          marginTop: 40,
          padding: '20px 24px',
          background: 'rgba(167, 139, 250, 0.06)',
          border: '1px solid rgba(167, 139, 250, 0.25)',
          borderRadius: 12,
          textAlign: 'center',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>
          Build your own
        </h2>
        <p style={{ margin: '0 0 14px', color: '#a1a1aa', fontSize: 13, lineHeight: 1.55 }}>
          OpenCanvas lets you talk to any LLM and watch it place typed widgets on
          an infinite canvas. BYO model, MCP-native, MIT.
        </p>
        <a
          href="/"
          style={{
            display: 'inline-block',
            padding: '10px 18px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            background: '#a78bfa',
            color: '#1f1d2e',
            textDecoration: 'none',
          }}
        >
          Try the demo →
        </a>
      </div>
    </>
  );
}

function Transcript({ messages }: { messages: ShareMessage[] }) {
  if (!messages || messages.length === 0) {
    return (
      <p style={{ color: '#71717a', fontSize: 13 }}>
        (Empty conversation — try sharing after sending a message.)
      </p>
    );
  }
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
      {messages.map((m, i) => (
        <MessageBlock key={i} message={m} />
      ))}
    </section>
  );
}

function MessageBlock({ message }: { message: ShareMessage }) {
  const text = (message.parts ?? [])
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
  const toolCalls = (message.parts ?? []).filter((p) =>
    p.type === 'dynamic-tool' || p.type.startsWith('tool-'),
  );
  const role = message.role === 'user' ? 'You' : 'OpenCanvas';
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        background: isUser ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
        border: isUser ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
        borderRadius: 12,
        padding: isUser ? '14px 16px' : '0 16px',
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.14,
          color: isUser ? '#a78bfa' : '#71717a',
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {role}
      </div>
      {text && (
        <div
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: '#fafafa',
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </div>
      )}
      {toolCalls.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 10,
          }}
        >
          {toolCalls.map((tc, i) => (
            <span
              key={i}
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'rgba(167, 139, 250, 0.15)',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                color: '#ddd6fe',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              }}
            >
              {toolNameOf(tc)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function toolNameOf(part: { type: string; toolName?: string }): string {
  if (part.type === 'dynamic-tool') return part.toolName ?? 'tool';
  return part.type.replace(/^tool-/, '');
}

function WidgetSummary({
  canvasSnapshot,
}: {
  canvasSnapshot: Record<string, unknown> | null;
}) {
  // Tldraw's serialized snapshot shape: { store: { 'shape:xxx': { type, props, ... } } }
  // Pull the count + kinds without rehydrating the whole editor.
  if (!canvasSnapshot || typeof canvasSnapshot !== 'object') return null;
  const store = (canvasSnapshot as { store?: Record<string, unknown> }).store;
  if (!store) return null;
  const shapes = Object.values(store).filter(
    (v): v is { type: string; meta?: Record<string, unknown> } =>
      typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string',
  );
  const widgets = shapes.filter((s) => s.type.startsWith('opencanvas:'));
  if (widgets.length === 0) {
    return (
      <p style={{ color: '#71717a', fontSize: 12, marginTop: 24 }}>
        (No widgets on this canvas yet.)
      </p>
    );
  }
  // Group by kind for a compact summary.
  const byKind = new Map<string, number>();
  for (const w of widgets) {
    const kind = w.type.replace(/^opencanvas:/, '');
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const kinds = Array.from(byKind.entries()).sort((a, b) => b[1] - a[1]);
  return (
    <section style={{ marginTop: 32 }}>
      <h2
        style={{
          margin: '0 0 10px',
          fontSize: 11,
          fontWeight: 600,
          color: '#a1a1aa',
          textTransform: 'uppercase',
          letterSpacing: 0.04,
        }}
      >
        Widgets on this canvas ({widgets.length})
      </h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {kinds.map(([kind, count]) => (
          <span
            key={kind}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#d4d4d8',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            }}
          >
            {kind} ×{count}
          </span>
        ))}
      </div>
    </section>
  );
}

function timeAgo(date: Date): string {
  const elapsed = Date.now() - date.getTime();
  const sec = Math.round(elapsed / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return date.toLocaleDateString();
}
