import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw, ServerCog, AlertTriangle, CheckCircle2 } from 'lucide-react';

type ConfiguredSource = {
  id: string;
  name: string;
  transport: string;
};

type ProbeResult = {
  ok: Array<{ id: string; name: string; toolCount: number; health: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
};

/**
 * Slide-in panel showing the user's configured MCP servers and (when
 * the user clicks "probe") their live tool count + health.
 *
 * Read-only for now — adding/removing requires editing
 * `~/.opencanvas/config.json` directly. The panel surfaces that path so
 * users know where to look.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `McpSourcesPanel`.
 */
export function McpSourcesPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [sources, setSources] = useState<ConfiguredSource[] | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetch('/v1/sources')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: { sources: ConfiguredSource[] }) => setSources(data.sources))
      .catch((e) => setError(String(e)));
  }, [open]);

  const runProbe = async () => {
    setProbing(true);
    setError(null);
    try {
      const res = await fetch('/v1/sources/probe');
      if (!res.ok) throw new Error(res.statusText);
      const data = (await res.json()) as ProbeResult;
      setProbe(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.32)',
              backdropFilter: 'blur(2px)',
              zIndex: 40,
            }}
          />
          <motion.aside
            initial={{ x: 480, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 480, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            style={{
              position: 'fixed',
              right: 0,
              top: 0,
              bottom: 0,
              width: 'min(440px, 92vw)',
              background: 'rgba(10,10,13,0.92)',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(18px)',
              zIndex: 41,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <ServerCog className="size-4" style={{ color: 'var(--color-accent)' }} />
              <h2
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--color-fg)',
                }}
              >
                MCP servers
              </h2>
              <button
                type="button"
                onClick={runProbe}
                disabled={probing}
                title="Probe — connect every source + introspect tools"
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'var(--color-fg-2)',
                  fontSize: 11.5,
                  cursor: probing ? 'not-allowed' : 'pointer',
                  opacity: probing ? 0.6 : 1,
                }}
              >
                <RefreshCw
                  className="size-3"
                  style={{
                    animation: probing ? 'spin 0.8s linear infinite' : undefined,
                  }}
                />
                {probing ? 'Probing…' : 'Probe'}
              </button>
              <button
                type="button"
                onClick={onClose}
                title="Close"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: 'transparent',
                  border: '1px solid transparent',
                  color: 'var(--color-muted)',
                  cursor: 'pointer',
                }}
              >
                <X className="size-3.5" />
              </button>
            </header>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {error && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.32)',
                    color: '#fecaca',
                    fontSize: 12.5,
                  }}
                >
                  {error}
                </div>
              )}

              {sources === null ? (
                <div style={{ color: 'var(--color-muted)', fontSize: 12.5 }}>
                  Loading…
                </div>
              ) : sources.length === 0 ? (
                <div
                  style={{
                    padding: 16,
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    fontSize: 12.5,
                    color: 'var(--color-fg-2)',
                  }}
                >
                  No MCP servers configured. Add them under{' '}
                  <code
                    style={{
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: 'rgba(167,139,250,0.12)',
                      color: '#ddd6fe',
                    }}
                  >
                    profiles[].sources
                  </code>{' '}
                  in <code>~/.opencanvas/config.json</code>.
                </div>
              ) : (
                sources.map((src) => {
                  const probeOk = probe?.ok.find((p) => p.id === src.id);
                  const probeFail = probe?.failed.find((p) => p.id === src.id);
                  return (
                    <div
                      key={src.id}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        background: 'rgba(255,255,255,0.025)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span style={{ fontWeight: 500, color: 'var(--color-fg)' }}>
                          {src.name}
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            color: 'var(--color-muted)',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {src.id}
                        </span>
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: 10.5,
                            color: 'var(--color-muted)',
                            textTransform: 'uppercase',
                            letterSpacing: 0.06,
                          }}
                        >
                          {src.transport}
                        </span>
                      </div>
                      {probeOk && (
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            color: 'var(--color-ok)',
                            fontSize: 11,
                          }}
                        >
                          <CheckCircle2 className="size-3" />
                          {probeOk.toolCount} tool
                          {probeOk.toolCount === 1 ? '' : 's'} — {probeOk.health}
                        </div>
                      )}
                      {probeFail && (
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            color: 'var(--color-fail)',
                            fontSize: 11,
                          }}
                        >
                          <AlertTriangle className="size-3" />
                          {probeFail.error}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <footer
              style={{
                padding: '10px 16px',
                fontSize: 11,
                color: 'var(--color-muted)',
                borderTop: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              Edit <code>~/.opencanvas/config.json</code> under{' '}
              <code>profiles[].sources</code> to add or remove servers.
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
