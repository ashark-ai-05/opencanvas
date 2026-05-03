import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tryRunCommand, suggestCommands } from '../../app/src/components/slash-commands';
import { useChatActions } from '../../app/src/state/chat-actions-store';
import { useTemplateStore } from '../../app/src/state/template-store';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

beforeEach(() => {
  useChatActions.setState({ newChat: null });
  useTemplateStore.setState({ activeTemplateId: 'ask-anything' });
});

describe('tryRunCommand', () => {
  it('returns false for messages that do not start with /', () => {
    expect(tryRunCommand('hello world')).toBe(false);
    expect(tryRunCommand('  hi')).toBe(false);
    expect(tryRunCommand('/')).toBe(false); // bare slash, no command
  });

  it('claims unknown commands so /typo never reaches the LLM', () => {
    expect(tryRunCommand('/notarealcommand')).toBe(true);
  });

  it('/clear invokes the registered newChat handler', () => {
    const fn = vi.fn();
    useChatActions.setState({ newChat: fn });
    expect(tryRunCommand('/clear')).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('/template <id> updates the active template store', () => {
    expect(tryRunCommand('/template tell-me-about-x')).toBe(true);
    expect(useTemplateStore.getState().activeTemplateId).toBe('tell-me-about-x');
  });

  it('/template with no arg or unknown id leaves the store unchanged', () => {
    expect(tryRunCommand('/template')).toBe(true);
    expect(useTemplateStore.getState().activeTemplateId).toBe('ask-anything');
    expect(tryRunCommand('/template made-up-template')).toBe(true);
    expect(useTemplateStore.getState().activeTemplateId).toBe('ask-anything');
  });

  it('/help is consumed (toast side-effect, no state change)', () => {
    expect(tryRunCommand('/help')).toBe(true);
    expect(useTemplateStore.getState().activeTemplateId).toBe('ask-anything');
  });

  it('trims leading/trailing whitespace', () => {
    expect(tryRunCommand('  /help   ')).toBe(true);
  });
});

describe('suggestCommands', () => {
  it('returns all commands when given an empty partial', () => {
    const all = suggestCommands('');
    expect(all.length).toBeGreaterThan(0);
    expect(all.find((c) => c.name === 'clear')).toBeDefined();
  });

  it('filters by prefix', () => {
    const m = suggestCommands('cl');
    expect(m.map((c) => c.name)).toEqual(['clear']);
  });

  it('case-insensitive prefix match', () => {
    expect(suggestCommands('TEMP').map((c) => c.name)).toEqual(['template']);
  });

  it('returns [] when nothing matches', () => {
    expect(suggestCommands('zzz')).toEqual([]);
  });
});
