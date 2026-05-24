import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Eye, EyeOff, Sparkles } from 'lucide-react';
import {
  useUserSettings,
  USER_PROVIDERS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_KEY_URLS,
  type UserProvider,
} from '../state/user-settings-store';

/**
 * "Settings" modal — currently scoped to BYO model + API key.
 *
 * Why this exists:
 *   The public Railway demo uses a single shared API key (Gemini Flash
 *   Lite Latest's free tier). For anyone wanting to (a) try a model
 *   that isn't on the free tier, (b) avoid sharing rate limits with
 *   other visitors, or (c) test their own provider, the friction was
 *   "set env vars on a server you don't own." This modal removes that.
 *
 * UX surface:
 *   - Provider radio group (6 providers: anthropic, openai, google,
 *     groq, openrouter, ollama)
 *   - Model id text field with a sensible default placeholder
 *   - API key password field with a show/hide toggle
 *   - "Get a free key" link per provider that opens the right console
 *   - Save / Reset buttons
 *
 * Persistence:
 *   Stored in localStorage via the user-settings-store. Sent on every
 *   /v1/chat request as X-OpenCanvas-* headers; backend overrides the
 *   resolved profile per-request. Never persisted server-side.
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stored = useUserSettings();
  const update = useUserSettings((s) => s.update);
  const reset = useUserSettings((s) => s.reset);

  // Local form state — applied to the store on Save.
  const [provider, setProvider] = useState<UserProvider | null>(stored.provider);
  const [model, setModel] = useState(stored.model);
  const [apiKey, setApiKey] = useState(stored.apiKey);
  const [showKey, setShowKey] = useState(false);

  // Sync local form when the modal opens (so reopening shows current).
  useEffect(() => {
    if (open) {
      setProvider(stored.provider);
      setModel(stored.model);
      setApiKey(stored.apiKey);
      setShowKey(false);
    }
  }, [open, stored.provider, stored.model, stored.apiKey]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSave = () => {
    update({ provider, model: model.trim(), apiKey: apiKey.trim() });
    onClose();
  };

  const handleReset = () => {
    reset();
    setProvider(null);
    setModel('');
    setApiKey('');
  };

  const handleProviderChange = (p: UserProvider) => {
    setProvider(p);
    // Suggest the default model whenever the provider changes and the
    // current model field is empty or matches a previous provider's
    // default (avoids stomping on a custom model the user typed in).
    const allDefaults = Object.values(PROVIDER_DEFAULT_MODELS);
    if (model.trim().length === 0 || allDefaults.includes(model.trim())) {
      setModel(PROVIDER_DEFAULT_MODELS[p]);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.62)',
              backdropFilter: 'blur(4px)',
              zIndex: 50,
            }}
          />
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(520px, calc(100vw - 32px))',
              maxHeight: 'calc(100vh - 64px)',
              overflowY: 'auto',
              background: 'var(--color-bg-1, #0a0a0a)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 16,
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4)',
              zIndex: 51,
              padding: '20px 22px',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Sparkles className="size-4" style={{ color: '#a78bfa' }} />
                <h2
                  id="settings-title"
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 600,
                    color: '#fafafa',
                    letterSpacing: '-0.012em',
                  }}
                >
                  Settings — BYO model
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close settings"
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
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                  e.currentTarget.style.color = '#fafafa';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#a1a1aa';
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
              Use your own API key for chat — stays in your browser, sent only with
              your own requests, never stored on the server. Leave this blank to
              use the demo's shared key (rate-limited).
            </p>

            {/* Provider radio group */}
            <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
              <legend
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#a1a1aa',
                  textTransform: 'uppercase',
                  letterSpacing: 0.04,
                  marginBottom: 8,
                }}
              >
                Provider
              </legend>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 6,
                }}
              >
                {USER_PROVIDERS.map((p) => {
                  const selected = provider === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleProviderChange(p)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                        background: selected
                          ? 'rgba(167, 139, 250, 0.15)'
                          : 'rgba(255, 255, 255, 0.03)',
                        border: selected
                          ? '1px solid rgba(167, 139, 250, 0.5)'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        color: selected ? '#ddd6fe' : '#d4d4d8',
                        transition: 'all 120ms ease',
                      }}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Model field */}
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="settings-model"
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#a1a1aa',
                  textTransform: 'uppercase',
                  letterSpacing: 0.04,
                  marginBottom: 6,
                }}
              >
                Model
              </label>
              <input
                id="settings-model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={
                  provider ? PROVIDER_DEFAULT_MODELS[provider] : 'pick a provider first'
                }
                disabled={!provider}
                style={{
                  width: '100%',
                  padding: '9px 11px',
                  borderRadius: 8,
                  fontSize: 13,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#fafafa',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                }}
              />
            </div>

            {/* API key field */}
            <div style={{ marginBottom: 18 }}>
              <label
                htmlFor="settings-api-key"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#a1a1aa',
                  textTransform: 'uppercase',
                  letterSpacing: 0.04,
                  marginBottom: 6,
                }}
              >
                <span>API key</span>
                {provider && (
                  <a
                    href={PROVIDER_KEY_URLS[provider]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 10,
                      color: '#a78bfa',
                      textDecoration: 'none',
                      textTransform: 'none',
                      letterSpacing: 'normal',
                      fontWeight: 500,
                    }}
                  >
                    get a free key
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="settings-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    provider === 'ollama'
                      ? 'no key needed for local ollama — leave blank'
                      : 'sk-…'
                  }
                  disabled={!provider}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    width: '100%',
                    padding: '9px 36px 9px 11px',
                    borderRadius: 8,
                    fontSize: 13,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#fafafa',
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  style={{
                    position: 'absolute',
                    right: 6,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 28,
                    height: 28,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: '#a1a1aa',
                    cursor: 'pointer',
                    borderRadius: 6,
                  }}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p
                style={{
                  margin: '6px 0 0',
                  fontSize: 10,
                  color: '#71717a',
                  lineHeight: 1.5,
                }}
              >
                Stored in this browser's localStorage. Sent only with chat requests
                you initiate. Cleared if you click Reset or your browser clears site
                data.
              </p>
            </div>

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: 12,
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <button
                type="button"
                onClick={handleReset}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 500,
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#a1a1aa',
                  cursor: 'pointer',
                }}
              >
                Reset to demo default
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    background: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#d4d4d8',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    background: 'rgba(167, 139, 250, 0.22)',
                    border: '1px solid rgba(167, 139, 250, 0.5)',
                    color: '#ddd6fe',
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
