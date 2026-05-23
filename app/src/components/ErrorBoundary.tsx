import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * App-level error boundary. Without this, a single throwing render
 * (corrupt widget payload, missing shape util, runtime null deref in a
 * child component) tears down the whole React tree and leaves the user
 * staring at a blank window with the only recourse being DevTools.
 *
 * What we show instead: the error message + stack, a "Copy details"
 * button so bug reports include real context, and a "Reload app"
 * button that triggers a hard reload. We deliberately don't offer a
 * "soft reset" — when the boundary fires, state is already untrusted.
 */
type Props = { children: ReactNode };
type State = { error: Error | null; info: ErrorInfo | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    // Log to console for DevTools — when a logger module is in place
    // this is the integration point.
    console.error('[opencanvas] uncaught render error:', error, info);
  }

  copyDetails = async () => {
    const { error, info } = this.state;
    const text = [
      `OpenCanvas error report`,
      `Time: ${new Date().toISOString()}`,
      `UA: ${navigator.userAgent}`,
      ``,
      `Error: ${error?.name}: ${error?.message}`,
      ``,
      `Stack:`,
      error?.stack ?? '(no stack)',
      ``,
      `Component stack:`,
      info?.componentStack ?? '(none)',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be denied — fall back to a download.
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'opencanvas-error.txt';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { error } = this.state;
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#fafafa',
          padding: 24,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          zIndex: 9999,
        }}
      >
        <div
          style={{
            maxWidth: 640,
            width: '100%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: 24,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              gap: 6,
              padding: '3px 10px',
              borderRadius: 999,
              background: 'rgba(251, 113, 133, 0.12)',
              border: '1px solid rgba(251, 113, 133, 0.3)',
              color: '#fb7185',
              fontSize: 11,
              marginBottom: 12,
            }}
          >
            something broke
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-0.012em',
            }}
          >
            OpenCanvas hit an error and stopped rendering
          </h1>
          <p style={{ margin: '6px 0 16px', color: '#a1a1aa', fontSize: 13 }}>
            Your canvas + conversations are saved on disk — reloading is
            non-destructive.
          </p>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 8,
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: 12,
              color: '#e4e4e7',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 200,
              overflow: 'auto',
            }}
          >
            {error.name}: {error.message}
          </pre>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 10,
                background: '#a78bfa',
                color: '#0a0a0a',
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload app
            </button>
            <button
              type="button"
              onClick={this.copyDetails}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 10,
                background: 'transparent',
                color: '#fafafa',
                border: '1px solid rgba(255,255,255,0.16)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Copy details
            </button>
          </div>
        </div>
      </div>
    );
  }
}
