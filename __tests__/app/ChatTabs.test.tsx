// __tests__/app/ChatTabs.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Store mocks — set up before importing the component so module-level store
// calls see the mocked versions.
// ---------------------------------------------------------------------------

const mockSelectOne = vi.fn();
const mockDeleteOne = vi.fn();
const mockRenameOne = vi.fn();
const mockCreateNew = vi.fn(() => 'conv-new');

let mockConversations = [
  { id: 'conv-a', title: 'Alpha chat', createdAt: 1, updatedAt: 1, messages: [] },
  { id: 'conv-b', title: 'Beta chat', createdAt: 2, updatedAt: 2, messages: [] },
];
let mockActiveId = 'conv-a';
let mockChatTabsVisible = true;
const mockSetChatTabsVisible = vi.fn((v: boolean) => { mockChatTabsVisible = v; });
const mockNewChat = vi.fn();

vi.mock('../../app/src/state/conversations-store', () => ({
  useConversationsStore: (selector: (s: unknown) => unknown) =>
    selector({
      conversations: mockConversations,
      activeId: mockActiveId,
      selectOne: mockSelectOne,
      deleteOne: mockDeleteOne,
      renameOne: mockRenameOne,
      createNew: mockCreateNew,
    }),
}));

// Also expose getState for the fallback path in ChatTabs
vi.mock('../../app/src/state/conversations-store', () => {
  const store = (selector: (s: unknown) => unknown) =>
    selector({
      conversations: mockConversations,
      activeId: mockActiveId,
      selectOne: mockSelectOne,
      deleteOne: mockDeleteOne,
      renameOne: mockRenameOne,
      createNew: mockCreateNew,
    });
  store.getState = () => ({
    conversations: mockConversations,
    activeId: mockActiveId,
    selectOne: mockSelectOne,
    deleteOne: mockDeleteOne,
    renameOne: mockRenameOne,
    createNew: mockCreateNew,
  });
  return { useConversationsStore: store };
});

vi.mock('../../app/src/state/ui-store', () => ({
  useUiStore: (selector: (s: unknown) => unknown) =>
    selector({
      chatTabsVisible: mockChatTabsVisible,
      setChatTabsVisible: mockSetChatTabsVisible,
    }),
}));

vi.mock('../../app/src/state/chat-actions-store', () => ({
  useChatActions: (selector: (s: unknown) => unknown) =>
    selector({ newChat: mockNewChat }),
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks are registered
// ---------------------------------------------------------------------------
import { ChatTabs } from '../../app/src/components/ChatTabs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockConversations = [
    { id: 'conv-a', title: 'Alpha chat', createdAt: 1, updatedAt: 1, messages: [] },
    { id: 'conv-b', title: 'Beta chat', createdAt: 2, updatedAt: 2, messages: [] },
  ];
  mockActiveId = 'conv-a';
  mockChatTabsVisible = true;
});

describe('<ChatTabs>', () => {
  it('renders nothing when chatTabsVisible is false', () => {
    mockChatTabsVisible = false;
    const { container } = render(<ChatTabs />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one tab per conversation when visible', () => {
    render(<ChatTabs />);
    const tabs = screen.getAllByTestId('chat-tab');
    expect(tabs).toHaveLength(2);
  });

  it('active tab has data-active="true"', () => {
    render(<ChatTabs />);
    const tabs = screen.getAllByTestId('chat-tab');
    const activeTab = tabs.find((t) => t.getAttribute('data-active') === 'true');
    expect(activeTab).toBeDefined();
    // The active one is conv-a (first in list, mockActiveId = 'conv-a')
    expect(activeTab).toHaveTextContent('Alpha chat');
  });

  it('inactive tabs have data-active="false"', () => {
    render(<ChatTabs />);
    const tabs = screen.getAllByTestId('chat-tab');
    const inactiveTabs = tabs.filter((t) => t.getAttribute('data-active') === 'false');
    expect(inactiveTabs).toHaveLength(1);
    expect(inactiveTabs[0]).toHaveTextContent('Beta chat');
  });

  it('clicking a tab calls selectOne with the conversation id', async () => {
    const user = userEvent.setup();
    render(<ChatTabs />);
    const tabs = screen.getAllByTestId('chat-tab');
    // Click the second tab (inactive)
    await user.click(tabs[1]!);
    expect(mockSelectOne).toHaveBeenCalledWith('conv-b');
  });

  it('double-clicking a tab title enters rename mode', async () => {
    const user = userEvent.setup();
    render(<ChatTabs />);
    const titles = screen.getAllByTestId('tab-title');
    // Double-click the first tab's title (active tab)
    await user.dblClick(titles[0]!);
    expect(screen.getByTestId('tab-rename-input')).toBeInTheDocument();
  });

  it('pressing Enter on the rename input calls renameOne', async () => {
    const user = userEvent.setup();
    render(<ChatTabs />);
    const titles = screen.getAllByTestId('tab-title');
    await user.dblClick(titles[0]!);

    const input = screen.getByTestId('tab-rename-input');
    await user.clear(input);
    await user.type(input, 'Renamed chat{Enter}');

    expect(mockRenameOne).toHaveBeenCalledWith('conv-a', 'Renamed chat');
  });

  it('pressing Escape cancels rename without saving', async () => {
    const user = userEvent.setup();
    render(<ChatTabs />);
    const titles = screen.getAllByTestId('tab-title');
    await user.dblClick(titles[0]!);

    const input = screen.getByTestId('tab-rename-input');
    await user.clear(input);
    await user.type(input, 'Should not save{Escape}');

    expect(mockRenameOne).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tab-rename-input')).not.toBeInTheDocument();
  });

  it('the + button calls newChat', async () => {
    const user = userEvent.setup();
    render(<ChatTabs />);
    await user.click(screen.getByTestId('chat-tabs-new-btn'));
    expect(mockNewChat).toHaveBeenCalledTimes(1);
  });

  it('close × on an inactive tab calls deleteOne with that id', async () => {
    const user = userEvent.setup();
    render(<ChatTabs />);
    // Only inactive tabs show a close button
    const closeBtn = screen.getByTestId('tab-close-btn');
    await user.click(closeBtn);
    expect(mockDeleteOne).toHaveBeenCalledWith('conv-b');
  });

  it('active tab does not show a close button', () => {
    render(<ChatTabs />);
    // Only 1 close button (the inactive tab), not 2
    const closeBtns = screen.queryAllByTestId('tab-close-btn');
    expect(closeBtns).toHaveLength(1);
  });

  it('renders the + button after all conversation tabs', () => {
    render(<ChatTabs />);
    const strip = screen.getByTestId('chat-tabs-strip');
    const children = Array.from(strip.children);
    const newBtn = screen.getByTestId('chat-tabs-new-btn');
    expect(children[children.length - 1]).toBe(newBtn);
  });
});
