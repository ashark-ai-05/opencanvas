import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// Mirrors NARROW_QUERY in app/src/lib/narrow-viewport.ts (app test asserts that side).
const NARROW_QUERY = '(max-width: 640px)';

const css = readFileSync('app/src/styles/globals.css', 'utf8');

describe('small-screen CSS', () => {
  it('has a media block matching the JS breakpoint', () => {
    expect(css).toContain(`@media ${NARROW_QUERY}`);
  });
  it('docks the chat as a bottom sheet and hides secondary tools', () => {
    const block = css.slice(css.indexOf(`@media ${NARROW_QUERY}`));
    expect(block).toMatch(/\.opencanvas-chat-floating\[data-narrow='true'\]/);
    expect(block).toMatch(/\.opencanvas-hide-narrow/);
    expect(block).toMatch(/safe-area-inset-bottom/);
    expect(block).toMatch(/font-size: 16px/); // no iOS input zoom
  });
  it('prevents horizontal page scroll', () => {
    expect(css).toMatch(/overflow-x: hidden/);
  });
});
