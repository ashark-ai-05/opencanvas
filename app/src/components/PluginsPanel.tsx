import { Boxes, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { DepthPanel } from './primitives';
import { usePluginRegistry } from '../state/plugin-registry-store';
import type { PluginKindDescriptor } from '../state/plugin-registry-store';
import { EXAMPLE_PLUGINS } from '../lib/plugin-examples';

interface PluginsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function PluginsPanel({ open, onClose }: PluginsPanelProps) {
  return (
    <DepthPanel
      open={open}
      onClose={onClose}
      placement="right"
      width="420px"
      ariaLabel="Plugins"
    >
      <PluginsPanelBody onClose={onClose} />
    </DepthPanel>
  );
}

// Built-in plugin kinds that cannot be uninstalled (they re-register on
// backend restart and are not user-managed).
const BUILTIN_KINDS = new Set(['chart']);

function PluginsPanelBody({ onClose }: { onClose: () => void }) {
  const byKind = usePluginRegistry((s) => s.byKind);
  const installed = Object.values(byKind);
  // Only show example plugins that are not already installed
  const available = EXAMPLE_PLUGINS.filter((ex) => !byKind[ex.descriptor.kind]);

  const handleInstall = async (descriptor: PluginKindDescriptor) => {
    try {
      const res = await fetch('/v1/canvas/widget-kinds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(descriptor),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      // SSE will push the update into usePluginRegistry automatically
    } catch (e) {
      console.error('[PluginsPanel] install failed', e);
      toast.error(
        `Failed to install "${descriptor.label ?? descriptor.kind}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const handleUninstall = async (kind: string, label?: string) => {
    try {
      const res = await fetch(`/v1/canvas/widget-kinds/${encodeURIComponent(kind)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      // SSE drives removal from usePluginRegistry
    } catch (e) {
      console.error('[PluginsPanel] uninstall failed', e);
      toast.error(
        `Failed to uninstall "${label ?? kind}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  return (
    <>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-line, rgba(255,255,255,0.06))',
          flexShrink: 0,
        }}
      >
        <Boxes className="size-4" style={{ color: 'var(--color-accent)' }} />
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-fg)',
          }}
        >
          Plugins
        </h2>
        {installed.length > 0 && (
          <span
            style={{
              marginLeft: 4,
              padding: '1px 7px',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 500,
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--color-muted)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {installed.length}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close plugins panel"
          style={{
            marginLeft: 'auto',
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

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Installed section */}
        <section>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-muted, #71717a)',
              fontWeight: 600,
            }}
          >
            Installed ({installed.length})
          </p>
          {installed.length === 0 ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.06)',
                fontSize: 13,
                color: 'var(--color-fg-2)',
              }}
            >
              No plugins installed yet. Install one from Examples below.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {installed.map((plugin) => (
                <PluginCard
                  key={plugin.kind}
                  plugin={plugin}
                  action={
                    BUILTIN_KINDS.has(plugin.kind)
                      ? null
                      : {
                          label: 'Uninstall',
                          icon: <Trash2 className="size-3.5" />,
                          onClick: () =>
                            handleUninstall(plugin.kind, plugin.label),
                          ariaLabel: `Uninstall ${plugin.label ?? plugin.kind}`,
                        }
                  }
                />
              ))}
            </div>
          )}
        </section>

        {/* Examples section — only shown when there are un-installed examples */}
        {available.length > 0 && (
          <section>
            <p
              style={{
                margin: '0 0 8px',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-muted, #71717a)',
                fontWeight: 600,
              }}
            >
              Examples ({available.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {available.map((ex) => (
                <PluginCard
                  key={ex.descriptor.kind}
                  plugin={ex.descriptor}
                  action={{
                    label: 'Install',
                    icon: <Plus className="size-3.5" />,
                    onClick: () => handleInstall(ex.descriptor),
                    ariaLabel: `Install ${ex.descriptor.label ?? ex.descriptor.kind}`,
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// PluginCard — one row per plugin
// ---------------------------------------------------------------------------
type CardAction = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
} | null;

function PluginCard({
  plugin,
  action,
}: {
  plugin: PluginKindDescriptor;
  action: CardAction;
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
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
        {/* kind chip */}
        <span
          style={{
            fontSize: 11,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            padding: '1px 7px',
            borderRadius: 5,
            background: 'rgba(255,255,255,0.05)',
            color: '#ddd6fe',
            border: '1px solid rgba(167,139,250,0.18)',
            flexShrink: 0,
          }}
        >
          {plugin.kind}
        </span>
        {/* label */}
        {plugin.label && (
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--color-fg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {plugin.label}
          </span>
        )}
        {/* action button */}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            aria-label={action.ariaLabel}
            title={action.label}
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 9px',
              borderRadius: 7,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--color-fg-2)',
              fontSize: 12,
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {action.icon}
            {action.label}
          </button>
        )}
      </div>
      {/* description */}
      {plugin.description && (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: 'var(--color-muted, #a1a1aa)',
            lineHeight: 1.45,
          }}
        >
          {plugin.description}
        </p>
      )}
    </div>
  );
}
