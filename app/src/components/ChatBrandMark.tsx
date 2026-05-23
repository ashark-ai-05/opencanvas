/**
 * Static brand dot in the chat title bar. Used to be a spinning conic
 * ring + breathing core; redesigned to a calm violet glow that lights
 * up brighter while the chat is streaming. Less dazzle, more focus.
 */
export function ChatBrandMark({ active = false }: { active?: boolean }) {
  return (
    <span
      className="opencanvas-chat-brand"
      data-active={active ? 'true' : 'false'}
      aria-hidden
    >
      <span className="opencanvas-chat-brand-core" />
    </span>
  );
}
