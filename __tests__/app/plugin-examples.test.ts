import { describe, it, expect } from 'vitest';
import { EXAMPLE_PLUGINS } from '../../app/src/lib/plugin-examples';

describe('EXAMPLE_PLUGINS', () => {
  it('exports the expected 4 example plugins', () => {
    const kinds = EXAMPLE_PLUGINS.map((p) => p.descriptor.kind).sort();
    expect(kinds).toEqual(['js-repl', 'mermaid', 'python-repl', 'qrcode']);
  });

  it('every plugin has label, description, renderer with srcdoc', () => {
    for (const p of EXAMPLE_PLUGINS) {
      expect(p.descriptor.kind).toBeTruthy();
      expect(p.descriptor.label).toBeTruthy();
      expect(p.descriptor.description).toBeTruthy();
      expect(p.descriptor.renderer.type).toBe('iframe');
      expect(typeof p.descriptor.renderer.srcdoc).toBe('string');
      expect(p.descriptor.renderer.srcdoc.length).toBeGreaterThan(50);
    }
  });

  it('python-repl srcdoc references pyodide', () => {
    const py = EXAMPLE_PLUGINS.find((p) => p.descriptor.kind === 'python-repl');
    expect(py).toBeDefined();
    expect(py!.descriptor.renderer.srcdoc).toContain('pyodide');
  });

  it('js-repl srcdoc has a Run button', () => {
    const js = EXAMPLE_PLUGINS.find((p) => p.descriptor.kind === 'js-repl');
    expect(js).toBeDefined();
    expect(js!.descriptor.renderer.srcdoc.toLowerCase()).toContain('run');
  });
});
