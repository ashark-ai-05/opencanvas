import { motion } from 'framer-motion';
import { Sparkles, Database, MessagesSquare, LayoutGrid } from 'lucide-react';
import { useKbStats } from '../state/kb-stats-store';
import { useTemplateStore } from '../state/template-store';
import { useConversationsStore } from '../state/conversations-store';

/**
 * Empty-state banner for the chat — slimmer, animated, contextual.
 *
 * Shows live numbers (KB chunk total, conversation count, active
 * template) instead of the previous static "Ask anything about your
 * knowledge" copy. Suggestions adapt to whether the canvas is fresh
 * (canonical first-asks) or already has indexed material (re-engage
 * prompts referencing the KB size).
 */
export function EmptyChatBanner({
  onSuggestion,
}: {
  onSuggestion: (text: string) => void;
}) {
  const totalChunks = useKbStats((s) => s.totalChunks);
  const conversationCount = useConversationsStore(
    (s) => s.conversations.length,
  );
  const templateId = useTemplateStore((s) => s.activeTemplateId);

  const indexed = totalChunks > 0;
  const suggestions = indexed
    ? [
        "What's in my knowledge base?",
        'Summarise recent conversations',
        'Compare two ideas I have notes on',
      ]
    : [
        'How does this app work?',
        'Compare REST vs gRPC',
        'Plan a project kickoff',
      ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.34, ease: [0.2, 0.8, 0.2, 1] }}
      className="opencanvas-empty-banner"
    >
      <div className="opencanvas-empty-banner-pill">
        <Sparkles className="size-3" />
        OpenCanvas · agent-driven canvas
      </div>

      <div className="opencanvas-empty-banner-title">
        {indexed ? 'Pick up where you left off.' : 'Ask anything to get started.'}
      </div>

      <div className="opencanvas-empty-banner-stats">
        <span className="opencanvas-empty-banner-stat">
          <Database className="size-3" style={{ color: 'var(--color-accent)' }} />
          <strong>{totalChunks.toLocaleString()}</strong>{' '}
          {totalChunks === 1 ? 'chunk' : 'chunks'} indexed
        </span>
        <span className="opencanvas-empty-banner-stat">
          <MessagesSquare className="size-3" style={{ color: 'var(--role-detail)' }} />
          <strong>{conversationCount}</strong>{' '}
          {conversationCount === 1 ? 'conversation' : 'conversations'}
        </span>
        <span className="opencanvas-empty-banner-stat">
          <LayoutGrid className="size-3" style={{ color: 'var(--role-related)' }} />
          template <strong>{templateId.replace(/-/g, ' ')}</strong>
        </span>
      </div>

      <div className="opencanvas-empty-banner-suggestions">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="opencanvas-empty-banner-suggestion"
            onClick={() => onSuggestion(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
