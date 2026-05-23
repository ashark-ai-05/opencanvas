// __tests__/app/DepthPanel.test.tsx
//
// @testing-library/react auto-cleans up between tests, so no manual
// document teardown is needed in beforeEach.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepthPanel } from '../../app/src/components/primitives/DepthPanel';

// The inert-on-#root focus-trap requires #root to exist. The renderer
// from @testing-library/react mounts into a fresh container that's NOT
// #root, so we add one explicitly for tests that need it.
beforeEach(() => {
  const rootEl = document.createElement('div');
  rootEl.id = 'root';
  document.body.appendChild(rootEl);
});

afterEach(() => {
  document.getElementById('root')?.remove();
});

describe('<DepthPanel>', () => {
  it('mounts content when open=true', () => {
    render(
      <DepthPanel open onClose={vi.fn()} ariaLabel="Test panel">
        <div data-testid="content">hello</div>
      </DepthPanel>,
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Test panel' })).toBeInTheDocument();
  });

  it('does not mount content when open=false', () => {
    render(
      <DepthPanel open={false} onClose={vi.fn()} ariaLabel="Test panel">
        <div data-testid="content">hello</div>
      </DepthPanel>,
    );
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('calls onClose when ESC is pressed (default)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DepthPanel open onClose={onClose} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on ESC when closeOnEscape=false', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DepthPanel
        open
        onClose={onClose}
        closeOnEscape={false}
        ariaLabel="Test panel"
      >
        <div>x</div>
      </DepthPanel>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked (default)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DepthPanel open onClose={onClose} ariaLabel="Test panel">
        <div>content</div>
      </DepthPanel>,
    );
    const backdrop = screen.getByTestId('depth-panel-backdrop');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on backdrop click when closeOnBackdrop=false', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DepthPanel
        open
        onClose={onClose}
        closeOnBackdrop={false}
        ariaLabel="Test panel"
      >
        <div>content</div>
      </DepthPanel>,
    );
    const backdrop = screen.getByTestId('depth-panel-backdrop');
    await user.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('honors placement="left" via data attribute', () => {
    render(
      <DepthPanel open onClose={vi.fn()} placement="left" ariaLabel="Left panel">
        <div>x</div>
      </DepthPanel>,
    );
    const aside = screen.getByRole('dialog', { name: 'Left panel' });
    expect(aside.getAttribute('data-placement')).toBe('left');
  });

  it('defaults placement to "right"', () => {
    render(
      <DepthPanel open onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    const aside = screen.getByRole('dialog', { name: 'Test panel' });
    expect(aside.getAttribute('data-placement')).toBe('right');
  });

  it('marks #root as inert while open and removes it on close', () => {
    const { rerender } = render(
      <DepthPanel open onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    const root = document.getElementById('root')!;
    expect(root.hasAttribute('inert')).toBe(true);

    rerender(
      <DepthPanel open={false} onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    expect(root.hasAttribute('inert')).toBe(false);
  });

  it('restores focus to the previously-active element on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <DepthPanel open onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );

    rerender(
      <DepthPanel open={false} onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    // Focus restoration is queued via queueMicrotask — flush before asserting.
    await Promise.resolve();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
