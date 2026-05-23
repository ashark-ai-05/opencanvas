// __tests__/app/SendWidgetMenu.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks — registered BEFORE importing the component under test.
// ---------------------------------------------------------------------------

// Fake shape the "editor" will return for getShape().
const FAKE_SHAPE = {
  id: 'shape:abc',
  type: 'opencanvas:markdown',
  meta: { role: 'primary' },
  props: { title: 'Test widget', body: 'hello' },
};

const mockGetShape = vi.fn(() => FAKE_SHAPE);
const mockDeleteShapes = vi.fn();

vi.mock('../../app/src/state/editor-ref', () => ({
  getEditor: () => ({
    getShape: mockGetShape,
    deleteShapes: mockDeleteShapes,
  }),
}));

// appendShapeToConversation — verify it's called with correct args.
const mockAppendShape = vi.fn();
vi.mock('../../app/src/canvas/persistence', () => ({
  appendShapeToConversation: (...args: unknown[]) => mockAppendShape(...args),
}));

// sonner toast — capture calls.
const mockToast = vi.fn();
vi.mock('sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// conversations store — expose a real-ish zustand-compatible interface so
// the component's useConversationsStore selector calls work.
let mockConversations = [
  { id: 'c-1', title: 'Current chat', messages: [], createdAt: 1000, updatedAt: 1000 },
  { id: 'c-2', title: 'Other chat A', messages: [], createdAt: 2000, updatedAt: 2000 },
  { id: 'c-3', title: 'Other chat B', messages: [], createdAt: 3000, updatedAt: 3000 },
];
let mockActiveId = 'c-1';
const mockSelectOne = vi.fn();

type StoreState = {
  conversations: typeof mockConversations;
  activeId: string;
  selectOne: typeof mockSelectOne;
};

// Simulate a minimal zustand store — the component subscribes via selector.
vi.mock('../../app/src/state/conversations-store', () => {
  const store = (selector: (s: StoreState) => unknown) =>
    selector({
      get conversations() { return mockConversations; },
      get activeId() { return mockActiveId; },
      selectOne: mockSelectOne,
    });
  store.getState = (): StoreState => ({
    conversations: mockConversations,
    activeId: mockActiveId,
    selectOne: mockSelectOne,
  });
  return { useConversationsStore: store };
});

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are in place.
// ---------------------------------------------------------------------------
import { SendWidgetMenu } from '../../app/src/components/SendWidgetMenu';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to three-conversation state.
  mockConversations = [
    { id: 'c-1', title: 'Current chat', messages: [], createdAt: 1000, updatedAt: 1000 },
    { id: 'c-2', title: 'Other chat A', messages: [], createdAt: 2000, updatedAt: 2000 },
    { id: 'c-3', title: 'Other chat B', messages: [], createdAt: 3000, updatedAt: 3000 },
  ];
  mockActiveId = 'c-1';
});

afterEach(() => {
  // Remove the stable portal container that SendWidgetMenu creates lazily.
  // This ensures each test starts clean without leftover portal DOM.
  const container = document.getElementById('__oc-send-portal__');
  if (container && container.parentNode === document.body) {
    document.body.removeChild(container);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<SendWidgetMenu>', () => {
  it('renders the Send trigger button', () => {
    render(<SendWidgetMenu shapeId="shape:abc" />);
    expect(
      screen.getByRole('button', { name: /send to another conversation/i }),
    ).toBeInTheDocument();
  });

  it('trigger button is enabled when other conversations exist', () => {
    render(<SendWidgetMenu shapeId="shape:abc" />);
    expect(
      screen.getByRole('button', { name: /send to another conversation/i }),
    ).not.toBeDisabled();
  });

  it('disables the trigger when there are no other conversations', () => {
    mockConversations = [
      { id: 'c-1', title: 'Only chat', messages: [], createdAt: 1000, updatedAt: 1000 },
    ];
    render(<SendWidgetMenu shapeId="shape:abc" />);
    const btn = screen.getByRole('button', {
      name: /no other conversations/i,
    });
    expect(btn).toBeDisabled();
  });

  it('opens the popover listing other conversations (excluding current) on click', async () => {
    const user = userEvent.setup();
    render(<SendWidgetMenu shapeId="shape:abc" />);
    await user.click(
      screen.getByRole('button', { name: /send to another conversation/i }),
    );
    expect(screen.getByText('Other chat A')).toBeInTheDocument();
    expect(screen.getByText('Other chat B')).toBeInTheDocument();
    expect(screen.queryByText('Current chat')).not.toBeInTheDocument();
  });

  it('closes the popover when clicked outside', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SendWidgetMenu shapeId="shape:abc" />
        <button type="button" data-testid="outside">outside</button>
      </div>,
    );
    await user.click(
      screen.getByRole('button', { name: /send to another conversation/i }),
    );
    expect(screen.getByText('Other chat A')).toBeInTheDocument();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByText('Other chat A')).not.toBeInTheDocument();
  });

  it('clicking a conversation row calls appendShapeToConversation + deleteShapes + toast', async () => {
    const user = userEvent.setup();
    render(<SendWidgetMenu shapeId="shape:abc" />);
    await user.click(
      screen.getByRole('button', { name: /send to another conversation/i }),
    );
    await user.click(screen.getByText('Other chat A'));

    // Should have read the shape from the editor.
    expect(mockGetShape).toHaveBeenCalledWith('shape:abc');

    // Should have appended the shape to the target conversation.
    expect(mockAppendShape).toHaveBeenCalledWith('c-2', FAKE_SHAPE);

    // Should have deleted from the current canvas.
    expect(mockDeleteShapes).toHaveBeenCalledWith(['shape:abc']);

    // Should have shown a toast.
    expect(mockToast).toHaveBeenCalledWith(
      'Moved to "Other chat A"',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Open' }) }),
    );
  });

  it('toast "Open" action calls selectOne with the target id', async () => {
    const user = userEvent.setup();
    render(<SendWidgetMenu shapeId="shape:abc" />);
    await user.click(
      screen.getByRole('button', { name: /send to another conversation/i }),
    );
    await user.click(screen.getByText('Other chat B'));

    // Extract the onClick from the action passed to toast and call it.
    const toastCall = mockToast.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    toastCall[1].action.onClick();
    expect(mockSelectOne).toHaveBeenCalledWith('c-3');
  });

  it('closes the popover after a conversation is selected', async () => {
    const user = userEvent.setup();
    render(<SendWidgetMenu shapeId="shape:abc" />);
    await user.click(
      screen.getByRole('button', { name: /send to another conversation/i }),
    );
    await user.click(screen.getByText('Other chat A'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('skips appendShape when getShape returns undefined (shape already gone)', async () => {
    mockGetShape.mockReturnValueOnce(undefined as never);
    const user = userEvent.setup();
    render(<SendWidgetMenu shapeId="shape:abc" />);
    await user.click(
      screen.getByRole('button', { name: /send to another conversation/i }),
    );
    await user.click(screen.getByText('Other chat A'));
    // appendShape should NOT be called when shape is undefined.
    expect(mockAppendShape).not.toHaveBeenCalled();
    expect(mockDeleteShapes).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });
});
