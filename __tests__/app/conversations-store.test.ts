import { describe, it, expect, beforeEach, vi } from 'vitest';

// Vitest hoists vi.mock above imports — but we want to reset the module
// between tests to re-trigger the loadInitial() side effect. Each test
// imports fresh via import().
async function freshStore() {
  vi.resetModules();
  return (await import('../../app/src/state/conversations-store')).useConversationsStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe('conversations-store — initial hydration', () => {
  it('starts with one empty conversation when localStorage is empty', async () => {
    const store = await freshStore();
    const s = store.getState();
    expect(s.conversations).toHaveLength(1);
    expect(s.conversations[0]!.title).toBe('New chat');
    expect(s.conversations[0]!.messages).toEqual([]);
    expect(s.activeId).toBe(s.conversations[0]!.id);
  });

  it('hydrates from saved conversations', async () => {
    const conv = {
      id: 'conv-x',
      title: 'Saved one',
      createdAt: 1,
      updatedAt: 2,
      messages: [],
    };
    localStorage.setItem('strata:conversations', JSON.stringify([conv]));
    localStorage.setItem('strata:active-conversation-id', 'conv-x');
    const store = await freshStore();
    expect(store.getState().conversations[0]!.id).toBe('conv-x');
    expect(store.getState().activeId).toBe('conv-x');
  });

  it('migrates legacy single-conversation localStorage into a new conversation', async () => {
    const legacyMessages = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'How does auth work?' }],
      },
    ];
    localStorage.setItem(
      'strata:chat-history:default',
      JSON.stringify(legacyMessages),
    );
    const store = await freshStore();
    const s = store.getState();
    expect(s.conversations).toHaveLength(1);
    expect(s.conversations[0]!.messages).toEqual(legacyMessages);
    // Auto-title from first user message
    expect(s.conversations[0]!.title).toMatch(/auth/i);
  });

  it('falls back gracefully on malformed legacy payloads', async () => {
    localStorage.setItem('strata:chat-history:default', 'not-json');
    const store = await freshStore();
    expect(store.getState().conversations).toHaveLength(1);
    expect(store.getState().conversations[0]!.title).toBe('New chat');
  });
});

describe('conversations-store — actions', () => {
  it('createNew prepends and selects the new conversation', async () => {
    const store = await freshStore();
    const beforeId = store.getState().conversations[0]!.id;
    const newId = store.getState().createNew();
    const s = store.getState();
    expect(s.conversations.length).toBe(2);
    expect(s.conversations[0]!.id).toBe(newId);
    expect(s.activeId).toBe(newId);
    expect(s.conversations[1]!.id).toBe(beforeId);
  });

  it('selectOne swaps activeId without mutating conversations', async () => {
    const store = await freshStore();
    const idA = store.getState().conversations[0]!.id;
    const idB = store.getState().createNew();
    store.getState().selectOne(idA);
    expect(store.getState().activeId).toBe(idA);
    store.getState().selectOne(idB);
    expect(store.getState().activeId).toBe(idB);
  });

  it('selectOne is a no-op for unknown ids', async () => {
    const store = await freshStore();
    const original = store.getState().activeId;
    store.getState().selectOne('does-not-exist');
    expect(store.getState().activeId).toBe(original);
  });

  it('deleteOne removes the conversation', async () => {
    const store = await freshStore();
    const idA = store.getState().conversations[0]!.id;
    const idB = store.getState().createNew();
    store.getState().deleteOne(idA);
    const s = store.getState();
    expect(s.conversations.find((c) => c.id === idA)).toBeUndefined();
    expect(s.conversations.find((c) => c.id === idB)).toBeDefined();
  });

  it('deleting the active conversation reassigns activeId', async () => {
    const store = await freshStore();
    const idA = store.getState().conversations[0]!.id;
    store.getState().createNew(); // makes a new active
    store.getState().selectOne(idA); // active = A
    store.getState().deleteOne(idA);
    expect(store.getState().activeId).not.toBe(idA);
  });

  it('deleting the only conversation creates a fresh empty one', async () => {
    const store = await freshStore();
    const id = store.getState().conversations[0]!.id;
    store.getState().deleteOne(id);
    const s = store.getState();
    expect(s.conversations).toHaveLength(1);
    expect(s.conversations[0]!.id).not.toBe(id);
    expect(s.conversations[0]!.messages).toEqual([]);
  });

  it('renameOne updates title and trims/falls-back-to-Untitled', async () => {
    const store = await freshStore();
    const id = store.getState().conversations[0]!.id;
    store.getState().renameOne(id, '  Auth flow  ');
    expect(store.getState().conversations[0]!.title).toBe('Auth flow');
    store.getState().renameOne(id, '');
    expect(store.getState().conversations[0]!.title).toBe('Untitled');
  });

  it('saveMessages auto-titles from first user message when title is the default', async () => {
    const store = await freshStore();
    const id = store.getState().conversations[0]!.id;
    store
      .getState()
      .saveMessages(id, [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'walk me through Plan 5' }] } as never,
      ]);
    expect(store.getState().conversations[0]!.title).toBe('walk me through Plan 5');
  });

  it('saveMessages preserves a user-renamed title', async () => {
    const store = await freshStore();
    const id = store.getState().conversations[0]!.id;
    store.getState().renameOne(id, 'Manual title');
    store
      .getState()
      .saveMessages(id, [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'something else' }] } as never,
      ]);
    expect(store.getState().conversations[0]!.title).toBe('Manual title');
  });
});
