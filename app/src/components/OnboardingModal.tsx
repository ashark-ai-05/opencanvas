import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * First-run onboarding modal. Shown when:
 *   1. The user hasn't dismissed it before (localStorage flag), AND
 *   2. The backend reports no functional LLM provider (we test by
 *      hitting /v1/health and inspecting the returned llm id).
 *
 * We don't write the user's API key from the renderer (security surface
 * — the backend already reads .env / ~/.opencanvas/config.json on
 * startup). Instead, the modal tells them exactly which env var to set
 * for the provider they want, then offers a "Test connection" button
 * that polls /v1/health.
 *
 * Closing the modal sets `opencanvas:onboarding-dismissed=1` in
 * localStorage. It will never reappear in this browser profile after
 * that, even if the env regresses.
 */
type Provider = {
  id: string;
  name: string;
  envVar: string;
  note: string;
  docsUrl: string;
};

const PROVIDERS: Provider[] = [
  {
    id: 'claude-agent-sdk',
    name: 'Claude (Agent SDK)',
    envVar: 'ANTHROPIC_API_KEY',
    note: 'Fastest agent loop via in-process MCP. OAuth via Claude Code also works — see README.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'anthropic-direct',
    name: 'Anthropic (direct)',
    envVar: 'ANTHROPIC_API_KEY',
    note: 'Plain Anthropic API — works with any Claude model.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    note: 'GPT-4o, GPT-4.1, and other OpenAI models.',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    note: 'One key, hundreds of models incl. Llama, Mistral, DeepSeek.',
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama (fully local)',
    envVar: '',
    note: 'No key needed. Install Ollama, pull a model (`ollama pull llama3.1:8b`), then set `llm.provider: "ollama"` in ~/.opencanvas/config.json.',
    docsUrl: 'https://ollama.com/download',
  },
  {
    id: 'amp',
    name: 'Sourcegraph Amp',
    envVar: 'AMP_API_KEY',
    note: "Sourcegraph's hosted agent loop.",
    docsUrl: 'https://ampcode.com',
  },
];

const DISMISS_KEY = 'opencanvas:onboarding-dismissed';

type HealthState = { llm: string; profile: string } | { error: string } | null;

export function OnboardingModal() {
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1',
  );
  const [picked, setPicked] = useState<string>(PROVIDERS[0]!.id);
  const [health, setHealth] = useState<HealthState>(null);
  const [testing, setTesting] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);

  // On mount: probe /v1/health and decide whether to show the modal.
  // We treat any 2xx with a valid llm field as "configured" — the
  // backend already filters out unreachable providers at startup, so
  // a returned llm id means it booted successfully against that
  // provider.
  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/v1/health');
        if (!res.ok) {
          if (!cancelled) setShouldShow(true);
          return;
        }
        const body = (await res.json()) as { llm?: string; profile?: string };
        if (cancelled) return;
        if (!body.llm || body.llm === 'unconfigured' || body.llm === 'none') {
          setShouldShow(true);
        }
      } catch {
        // Backend unreachable → show the modal so the user knows they
        // need to set things up.
        if (!cancelled) setShouldShow(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dismissed]);

  const probe = async () => {
    setTesting(true);
    setHealth(null);
    try {
      const res = await fetch('/v1/health');
      if (!res.ok) {
        setHealth({ error: `Backend returned ${res.status}` });
      } else {
        setHealth(await res.json());
      }
    } catch (e) {
      setHealth({ error: e instanceof Error ? e.message : 'unknown error' });
    } finally {
      setTesting(false);
    }
  };

  const close = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
    setShouldShow(false);
  };

  const provider = PROVIDERS.find((p) => p.id === picked)!;
  const healthy =
    health && 'llm' in health && health.llm && health.llm !== 'unconfigured';

  if (dismissed || !shouldShow) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          zIndex: 9998,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            width: '100%',
            maxWidth: 640,
            background: 'rgba(24, 24, 27, 0.92)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 18,
            padding: 28,
            color: '#fafafa',
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, Inter, "Segoe UI", Roboto, sans-serif',
            boxShadow: '0 28px 80px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(167, 139, 250, 0.14)',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                marginBottom: 12,
              }}
            >
              <Sparkles className="size-3" style={{ color: '#c4b5fd' }} />
              <span style={{ fontSize: 11, color: '#c4b5fd', letterSpacing: 0.02 }}>
                welcome
              </span>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Skip onboarding"
              style={{
                marginLeft: 'auto',
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                padding: 6,
                borderRadius: 6,
              }}
            >
              <X className="size-4" />
            </button>
          </div>

          <h2
            id="onboarding-title"
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.012em',
            }}
          >
            Pick an LLM to get started
          </h2>
          <p style={{ margin: '6px 0 18px', color: '#a1a1aa', fontSize: 13, lineHeight: 1.55 }}>
            OpenCanvas is BYO-credentials — no key ever leaves your machine. Pick a
            provider, set its env var in <code style={codeChip}>.env</code>, restart
            the backend, then test below.
          </p>

          {/* Provider picker */}
          <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
            {PROVIDERS.map((p) => (
              <label
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background:
                    picked === p.id
                      ? 'rgba(167,139,250,0.10)'
                      : 'rgba(255,255,255,0.02)',
                  border:
                    picked === p.id
                      ? '1px solid rgba(167,139,250,0.4)'
                      : '1px solid rgba(255,255,255,0.06)',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p.id}
                  checked={picked === p.id}
                  onChange={() => setPicked(p.id)}
                  style={{ accentColor: '#a78bfa' }}
                />
                <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{p.name}</span>
                {p.envVar && (
                  <code style={codeChip} title="Set this env var in .env">
                    {p.envVar}
                  </code>
                )}
              </label>
            ))}
          </div>

          {/* Selected provider details */}
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.05)',
              marginBottom: 16,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                color: '#d4d4d8',
                lineHeight: 1.55,
              }}
            >
              {provider.note}
            </p>
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 8,
                fontSize: 12,
                color: '#a78bfa',
                textDecoration: 'none',
              }}
            >
              {provider.envVar ? 'Get an API key' : 'Install Ollama'}
              <ExternalLink className="size-3" />
            </a>
          </div>

          {/* Test connection */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <button
              type="button"
              onClick={probe}
              disabled={testing}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                background: 'rgba(167,139,250,0.18)',
                border: '1px solid rgba(167,139,250,0.35)',
                color: '#ddd6fe',
                fontSize: 12.5,
                fontWeight: 500,
                cursor: testing ? 'not-allowed' : 'pointer',
                opacity: testing ? 0.7 : 1,
              }}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {health && 'llm' in health && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#86efac' }}>
                <CheckCircle2 className="size-3.5" />
                Connected · profile: <code style={codeChip}>{health.profile}</code> · llm: <code style={codeChip}>{health.llm}</code>
              </span>
            )}
            {health && 'error' in health && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#fca5a5' }}>
                <AlertCircle className="size-3.5" />
                {health.error}
              </span>
            )}
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              onClick={close}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 10,
                background: healthy ? '#a78bfa' : 'rgba(255,255,255,0.06)',
                color: healthy ? '#0a0a0a' : '#fafafa',
                border: healthy
                  ? 'none'
                  : '1px solid rgba(255,255,255,0.12)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {healthy ? "I'm set up — let's go" : 'Skip for now'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

const codeChip: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 5,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  fontFamily:
    'ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
  fontSize: 11,
  color: '#e4e4e7',
};
