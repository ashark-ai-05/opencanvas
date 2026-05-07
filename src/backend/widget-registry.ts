/**
 * Global registry of plugin widget kinds.
 *
 * External processes (MCPs, scripts, dashboards) register a new
 * widget kind by POSTing a `PluginRenderer` descriptor. Subsequent
 * calls to place_widget(kind: '<registered>') route through the
 * dispatcher's 'plugin' shape, which renders via the descriptor.
 *
 * V1 supports only the `iframe` renderer (sandboxed iframe with a
 * srcdoc HTML template + postMessage prop bridge). vega-lite and
 * web-component renderers are V2; the descriptor union is shaped to
 * accommodate them without a registry-protocol break.
 *
 * Ownership: the registry is per-backend-process and global across
 * conversations. Tearing down the backend forgets registrations;
 * a re-registration on startup is the simplest persistence story
 * (each plugin owns its own re-register).
 */

export type IframeRenderer = {
  type: 'iframe';
  /**
   * The HTML template loaded into the iframe's srcdoc. The template
   * receives the widget's props via window.opencanvas.props (set
   * before the document fires DOMContentLoaded) AND via a
   * postMessage of {type: 'opencanvas:props', props} on every
   * subsequent update.
   */
  srcdoc: string;
  /**
   * Optional sandbox flags. Default 'allow-scripts' so the template
   * can execute without leaking storage / cookies. Pass
   * 'allow-same-origin' explicitly when the template needs that —
   * it's a real security trade-off and we want it opt-in per kind.
   */
  sandbox?: string;
  /** Default size hint for the dispatcher's slot resolver. */
  defaultSize?: { w: number; h: number };
};

export type PluginRenderer = IframeRenderer;

export type PluginKindDescriptor = {
  /** Registered kind name (must be unique, not a built-in WidgetKind). */
  kind: string;
  /** Human-readable label — shown in the card header / chat anchor. */
  label?: string;
  /** Short description — surfaces in the Cmd+K palette + agent prompts. */
  description?: string;
  /** Renderer descriptor. */
  renderer: PluginRenderer;
};

type Listener = (event: WidgetRegistryEvent) => void;
export type WidgetRegistryEvent =
  | { type: 'register'; descriptor: PluginKindDescriptor }
  | { type: 'unregister'; kind: string };

export class WidgetRegistry {
  private kinds = new Map<string, PluginKindDescriptor>();
  private listeners = new Set<Listener>();

  /**
   * Register or replace a plugin kind. Replacement is intentional —
   * a plugin can hot-update its renderer without a unregister/register
   * dance. Returns the descriptor that was stored (after defaulting).
   */
  register(d: PluginKindDescriptor): PluginKindDescriptor {
    const stored: PluginKindDescriptor = {
      kind: d.kind,
      ...(d.label ? { label: d.label } : {}),
      ...(d.description ? { description: d.description } : {}),
      renderer: applyRendererDefaults(d.renderer),
    };
    this.kinds.set(d.kind, stored);
    this.emit({ type: 'register', descriptor: stored });
    return stored;
  }

  unregister(kind: string): boolean {
    const had = this.kinds.delete(kind);
    if (had) this.emit({ type: 'unregister', kind });
    return had;
  }

  has(kind: string): boolean {
    return this.kinds.has(kind);
  }

  get(kind: string): PluginKindDescriptor | undefined {
    return this.kinds.get(kind);
  }

  list(): PluginKindDescriptor[] {
    return Array.from(this.kinds.values()).sort((a, b) =>
      a.kind.localeCompare(b.kind),
    );
  }

  /** Subscribe to register/unregister events. Returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: WidgetRegistryEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (e) {
        console.warn('[widget-registry] listener threw:', e);
      }
    }
  }
}

function applyRendererDefaults(r: PluginRenderer): PluginRenderer {
  if (r.type === 'iframe') {
    return {
      type: 'iframe',
      srcdoc: r.srcdoc,
      sandbox: r.sandbox ?? 'allow-scripts',
      ...(r.defaultSize ? { defaultSize: r.defaultSize } : {}),
    };
  }
  return r;
}
