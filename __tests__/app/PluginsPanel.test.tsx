import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PluginsPanel } from '../../app/src/components/PluginsPanel';
import { usePluginRegistry } from '../../app/src/state/plugin-registry-store';

beforeEach(() => {
  usePluginRegistry.setState({ byKind: {}, hydrated: true });
  // Set up #root for DepthPanel's inert focus-trap
  const rootEl = document.createElement('div');
  rootEl.id = 'root';
  document.body.appendChild(rootEl);
  // Mock fetch for install/uninstall calls
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
  document.getElementById('root')?.remove();
  vi.restoreAllMocks();
});

describe('<PluginsPanel>', () => {
  it('renders empty installed state when no plugins are registered', () => {
    render(<PluginsPanel open onClose={vi.fn()} />);
    // The "Installed" section heading shows 0 count
    expect(screen.getByText(/installed \(0\)/i)).toBeInTheDocument();
    // Both example plugins appear under Examples (matched by their labels)
    expect(screen.getByText('Mermaid Diagram')).toBeInTheDocument();
    expect(screen.getByText('QR Code')).toBeInTheDocument();
  });

  it('shows installed plugins from the registry', () => {
    usePluginRegistry.setState({
      byKind: {
        chart: {
          kind: 'chart',
          label: 'Chart',
          description: 'Vega-Lite chart',
          renderer: { type: 'iframe', srcdoc: '<html></html>' },
        },
      },
      hydrated: true,
    });
    render(<PluginsPanel open onClose={vi.fn()} />);
    expect(screen.getByText('Chart')).toBeInTheDocument();
  });

  it('does not show uninstall button for built-in chart plugin', () => {
    usePluginRegistry.setState({
      byKind: {
        chart: {
          kind: 'chart',
          label: 'Chart',
          description: 'Vega-Lite chart',
          renderer: { type: 'iframe', srcdoc: '<html></html>' },
        },
      },
      hydrated: true,
    });
    render(<PluginsPanel open onClose={vi.fn()} />);
    // The chart row exists
    expect(screen.getByText('Chart')).toBeInTheDocument();
    // But there is no uninstall button for it
    const uninstallBtn = screen.queryByRole('button', { name: /uninstall chart/i });
    expect(uninstallBtn).toBeNull();
  });

  it('clicking install on an example calls POST /v1/canvas/widget-kinds', async () => {
    const user = userEvent.setup();
    render(<PluginsPanel open onClose={vi.fn()} />);
    const installButtons = screen.getAllByRole('button', { name: /install/i });
    await user.click(installButtons[0]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/v1/canvas/widget-kinds',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
  });

  it('hides example plugin when it becomes installed', () => {
    usePluginRegistry.setState({
      byKind: {
        mermaid: {
          kind: 'mermaid',
          label: 'Mermaid Diagram',
          description: 'A mermaid renderer',
          renderer: { type: 'iframe', srcdoc: '<html></html>' },
        },
      },
      hydrated: true,
    });
    render(<PluginsPanel open onClose={vi.fn()} />);
    // Mermaid label appears exactly once (in installed section, not in examples)
    const mermaidLabels = screen.getAllByText('Mermaid Diagram');
    expect(mermaidLabels.length).toBe(1);
    // QR code still appears in examples
    expect(screen.getByText('QR Code')).toBeInTheDocument();
  });

  it('lists python-repl and js-repl in the available examples', () => {
    render(<PluginsPanel open onClose={vi.fn()} />);
    expect(screen.getByText('Python REPL')).toBeInTheDocument();
    expect(screen.getByText('JavaScript REPL')).toBeInTheDocument();
  });
});
