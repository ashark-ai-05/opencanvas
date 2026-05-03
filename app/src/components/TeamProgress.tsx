import type { UIMessage } from 'ai';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader } from 'lucide-react';

/**
 * Horizontal team-pipeline indicator that surfaces above the chat
 * while a /team run is in flight. Reads `data-team-phase` parts from
 * the latest assistant message — the team route emits a 'start' signal
 * when each phase begins and a 'complete' signal when it finishes. The
 * component derives an active/complete status per agent from those.
 *
 * Hides itself entirely if no team phase parts are present, so regular
 * chat turns don't see this UI at all.
 */
const PHASES = [
  { role: 'research', label: 'Researcher', tint: 'var(--role-primary)', icon: '🔬' },
  { role: 'build', label: 'Builder', tint: 'var(--role-detail)', icon: '🛠' },
  { role: 'review', label: 'Critic', tint: 'var(--role-reference)', icon: '🔍' },
] as const;

type PhaseStatus = 'pending' | 'active' | 'complete';

export function TeamProgress({ messages }: { messages: UIMessage[] }) {
  const statuses = computeStatuses(messages);
  const visible = Object.values(statuses).some((s) => s !== 'pending');

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className="strata-glass border-b border-white/5 overflow-hidden"
        >
          <div className="px-5 py-3 flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">
              Team
            </span>
            <div className="flex items-center gap-2 flex-1">
              {PHASES.map((p, i) => (
                <PhaseNode
                  key={p.role}
                  phase={p}
                  status={statuses[p.role]}
                  isLast={i === PHASES.length - 1}
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PhaseNode({
  phase,
  status,
  isLast,
}: {
  phase: (typeof PHASES)[number];
  status: PhaseStatus;
  isLast: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <PhaseDot status={status} tint={phase.tint} />
        <span
          className="text-[12px] font-medium truncate"
          style={{
            color:
              status === 'pending'
                ? 'var(--color-muted)'
                : status === 'active'
                ? '#fafafa'
                : 'var(--color-fg-2)',
          }}
        >
          {phase.icon} {phase.label}
        </span>
      </div>
      {!isLast && (
        <div
          className="flex-1 h-px"
          style={{
            background:
              status === 'complete'
                ? `linear-gradient(90deg, ${phase.tint}, var(--color-line-2))`
                : 'var(--color-line)',
            transition: 'background 240ms ease',
          }}
        />
      )}
    </>
  );
}

function PhaseDot({ status, tint }: { status: PhaseStatus; tint: string }) {
  if (status === 'complete') {
    return (
      <span
        className="inline-flex items-center justify-center size-5 rounded-full"
        style={{ background: tint, color: '#0a0a0a' }}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span
        className="inline-flex items-center justify-center size-5 rounded-full strata-team-dot-active"
        style={{ background: tint, color: '#0a0a0a' }}
      >
        <Loader className="size-3 animate-spin" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block size-5 rounded-full"
      style={{
        background: 'transparent',
        border: '1px dashed var(--color-line-2)',
      }}
    />
  );
}

/**
 * Walk the latest assistant message's parts looking for data-team-phase
 * signals. AI SDK 6 surfaces custom data parts as `{type: 'data-<name>',
 * data: {...}}`. Earlier messages are ignored — the pipeline only
 * reflects the IN-FLIGHT or MOST-RECENT team run, not historical ones.
 */
function computeStatuses(messages: UIMessage[]): Record<string, PhaseStatus> {
  const init: Record<string, PhaseStatus> = {
    research: 'pending',
    build: 'pending',
    review: 'pending',
  };
  // Find the last assistant message (most recent).
  let lastAssistant: UIMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      lastAssistant = messages[i];
      break;
    }
  }
  if (!lastAssistant) return init;

  for (const p of lastAssistant.parts as Array<{
    type: string;
    data?: { agent?: string; status?: string };
  }>) {
    if (p.type !== 'data-team-phase') continue;
    const agent = p.data?.agent;
    const status = p.data?.status;
    if (!agent || !(agent in init)) continue;
    if (status === 'start') {
      init[agent] = 'active';
    } else if (status === 'complete') {
      init[agent] = 'complete';
    }
  }
  return init;
}
