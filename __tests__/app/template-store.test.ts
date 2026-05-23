import { describe, it, expect } from 'vitest';
import { useTemplateStore } from '../../app/src/state/template-store';

describe('useTemplateStore', () => {
  it('starts at the default template id', () => {
    const { activeTemplateId } = useTemplateStore.getState();
    expect(activeTemplateId).toBe('ask-anything');
  });

  it('setActiveTemplateId switches templates', () => {
    useTemplateStore.getState().setActiveTemplateId('tell-me-about-x');
    expect(useTemplateStore.getState().activeTemplateId).toBe('tell-me-about-x');

    // Reset for downstream tests
    useTemplateStore.getState().setActiveTemplateId('ask-anything');
  });
});
