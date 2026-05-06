import { motion } from 'framer-motion';

/**
 * Tiny animated brand mark rendered to the left of "OpenCanvas" in the
 * floating chat title bar. Idle state: gentle breath + slow rotation of an
 * inner conic gradient. Active state (chat is streaming): faster rotation,
 * brighter ring. SVG keeps the surface area predictable across DPI.
 */
export function ChatBrandMark({ active = false }: { active?: boolean }) {
  return (
    <motion.span
      className="opencanvas-chat-brand"
      data-active={active ? 'true' : 'false'}
      aria-hidden
      animate={{
        scale: active ? [1, 1.06, 1] : [1, 1.03, 1],
      }}
      transition={{
        duration: active ? 1.6 : 3.2,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    >
      <span className="opencanvas-chat-brand-ring" />
      <span className="opencanvas-chat-brand-core" />
    </motion.span>
  );
}
