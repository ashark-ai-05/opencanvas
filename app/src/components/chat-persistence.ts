import type { UIMessage } from 'ai';

const CHAT_STORAGE_KEY = 'strata:chat-history:default';

/**
 * Persist UIMessage[] from useChat to localStorage. Saves are best-effort:
 * a quota error or serialization failure logs and moves on rather than
 * crashing the chat surface.
 */
export function saveChatHistory(messages: UIMessage[]): void {
  try {
    if (messages.length === 0) {
      localStorage.removeItem(CHAT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
  } catch (e) {
    console.warn('[chat] save failed:', e);
  }
}

export function loadChatHistory(): UIMessage[] {
  const raw = localStorage.getItem(CHAT_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as UIMessage[];
  } catch (e) {
    console.warn('[chat] load failed:', e);
    return [];
  }
}

export function clearChatHistory(): void {
  localStorage.removeItem(CHAT_STORAGE_KEY);
}

/**
 * Walk every loaded message's parts and collect tool-output-available
 * toolCallIds. Used to seed Chat's appliedRef on mount so we don't replay
 * directives that were already dispatched in a previous session.
 */
export function collectAppliedToolCallIds(messages: UIMessage[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    for (const p of m.parts as Array<{ type: string; state?: string; toolCallId?: string }>) {
      const isTool = p.type === 'dynamic-tool' || p.type.startsWith('tool-');
      if (isTool && p.state === 'output-available' && p.toolCallId) {
        ids.push(p.toolCallId);
      }
    }
  }
  return ids;
}
