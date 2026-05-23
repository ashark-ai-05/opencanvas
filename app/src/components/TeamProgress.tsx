import type { UIMessage } from 'ai';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, Loader } from 'lucide-react';

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
  const { statuses, current } = computeAgentActivity(messages);
  const visible = Object.values(statuses).some((s) => s !== 'pending');
  const activeTint =
    current && PHASES.find((p) => p.role === current.agent)?.tint;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className="opencanvas-glass border-b border-white/5 overflow-hidden"
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
          {/* Live "what's the active agent doing right now" line. Tracks the
              most recent in-flight tool call attributed to whichever agent's
              phase is currently open. Disappears the instant the tool's
              output arrives. */}
          <AnimatePresence mode="wait">
            {current && (
              <motion.div
                key={`${current.agent}-${current.toolCallId}`}
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.18 }}
                className="px-5 pb-3 -mt-1 flex items-center gap-2 text-[12px]"
              >
                <span
                  className="inline-block size-1.5 rounded-full"
                  style={{
                    background: activeTint ?? 'var(--color-accent)',
                    boxShadow: `0 0 6px 0 ${activeTint ?? 'var(--color-accent)'}`,
                    animation: 'opencanvas-team-pulse 1.4s ease-in-out infinite',
                  }}
                />
                <span className="text-zinc-500">
                  {agentVerb(current.tool)}
                </span>
                <span
                  className="font-mono truncate"
                  style={{ color: activeTint ?? '#a78bfa' }}
                >
                  {current.tool}
                </span>
                {current.preview && (
                  <span className="text-zinc-500 truncate font-mono text-[11px]">
                    {current.preview}
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Verb tense for the live indicator — keeps it readable without leaning
 * on the tool name to also be a verb. Falls back to "calling" for unknowns.
 */
function agentVerb(tool: string): string {
  const t = tool.toLowerCase();
  if (t.includes('search')) return 'searching';
  if (t.includes('fetch') || t.includes('read')) return 'reading';
  if (t.includes('place')) return 'placing';
  if (t.includes('link')) return 'linking';
  if (t.includes('focus')) return 'focusing';
  if (t.includes('clear')) return 'clearing';
  if (t.includes('switch')) return 'switching to';
  return 'running';
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
        className="inline-flex items-center justify-center size-5 rounded-full opencanvas-team-dot-active"
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
 * Walk the latest assistant message's parts in stream order, tracking:
 *   1. Each agent's status (pending / active / complete) from the
 *      data-team-phase signals
 *   2. Which agent's phase is currently OPEN (start emitted, complete not yet)
 *   3. The most recent in-flight tool call attributed to that agent —
 *      the call whose state is input-available/streaming and whose
 *      toolCallId hasn't seen a matching output-available/error yet.
 *
 * Returns both the per-agent statuses and the live activity, so the
 * timeline can render dots + a "currently doing" line.
 */
type AgentActivity = {
  statuses: Record<string, PhaseStatus>;
  current:
    | {
        agent: string;
        tool: string;
        toolCallId: string;
        preview: string | null;
      }
    | null;
};

function computeAgentActivity(messages: UIMessage[]): AgentActivity {
  const init: Record<string, PhaseStatus> = {
    research: 'pending',
    build: 'pending',
    review: 'pending',
  };
  let lastAssistant: UIMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      lastAssistant = messages[i];
      break;
    }
  }
  if (!lastAssistant) return { statuses: init, current: null };

  let openAgent: string | null = null;
  // Track the most recent in-flight call. We update as we walk; if a
  // matching output-available comes later in stream order, we clear it.
  let inFlight: AgentActivity['current'] = null;

  for (const p of lastAssistant.parts as Array<{
    type: string;
    state?: string;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
    data?: { agent?: string; status?: string };
  }>) {
    if (p.type === 'data-team-phase') {
      const agent = p.data?.agent;
      const status = p.data?.status;
      if (!agent || !(agent in init)) continue;
      if (status === 'start') {
        init[agent] = 'active';
        openAgent = agent;
      } else if (status === 'complete') {
        init[agent] = 'complete';
        if (openAgent === agent) openAgent = null;
        // Clear in-flight when the phase closes — its tools are done by then.
        if (inFlight && inFlight.agent === agent) inFlight = null;
      }
    } else if (
      (p.type === 'dynamic-tool' || p.type.startsWith('tool-')) &&
      openAgent &&
      p.toolCallId
    ) {
      const tool = readToolName(p.type, p.toolName);
      if (p.state === 'input-available' || p.state === 'input-streaming') {
        inFlight = {
          agent: openAgent,
          tool,
          toolCallId: p.toolCallId,
          preview: previewInput(p.input),
        };
      } else if (
        (p.state === 'output-available' || p.state === 'output-error') &&
        inFlight?.toolCallId === p.toolCallId
      ) {
        inFlight = null;
      }
    }
  }

  return { statuses: init, current: inFlight };
}

/** Pretty tool name — strips `tool-` and `mcp__<server>__` prefixes. */
function readToolName(type: string, dynamicToolName?: string): string {
  if (type === 'dynamic-tool') return dynamicToolName ?? 'unknown';
  const raw = type.slice('tool-'.length);
  const last = raw.split('__').pop();
  return last && last.length > 0 ? last : raw;
}

/** Compact preview of the active call's interesting argument. */
function previewInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  for (const k of ['query', 'q', 'path', 'id', 'url', 'pattern', 'name']) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) {
      const trimmed = v.length > 56 ? `${v.slice(0, 55)}…` : v;
      return `"${trimmed}"`;
    }
  }
  if (typeof obj['kind'] === 'string' && typeof obj['role'] === 'string') {
    return `${obj['kind']} → ${obj['role']}`;
  }
  return null;
}

const ROLE_TINT: Record<string, string> = {
  research: 'var(--role-primary)',
  build: 'var(--role-detail)',
  review: 'var(--role-reference)',
};

const ROLE_LABEL: Record<string, string> = {
  research: 'Researcher',
  build: 'Builder',
  review: 'Critic',
  builder: 'Builder',
  critic: 'Critic',
  researcher: 'Researcher',
};

/**
 * "Baton pass" card rendered between phase blocks in the chat. Shows
 * the agent who just finished, an arrow, and the agent it's passing to,
 * plus the inline handoff message. Visible team chemistry — every team
 * run reads as a literal collaboration rather than three monologues.
 */
export function TeamHandoff({
  from,
  to,
  message,
}: {
  from: string;
  to: string;
  message: string;
}) {
  const fromTint = ROLE_TINT[from] ?? 'var(--color-muted)';
  const toTint = ROLE_TINT[to] ?? 'var(--color-muted)';
  const fromLabel = ROLE_LABEL[from] ?? from;
  const toLabel = ROLE_LABEL[to] ?? to;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1.2, 0.3, 1] }}
      className="my-3 opencanvas-handoff"
      style={{
        background: `linear-gradient(90deg, color-mix(in oklab, ${fromTint} 14%, transparent), color-mix(in oklab, ${toTint} 14%, transparent))`,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <PhasePill label={fromLabel} tint={fromTint} done />
        <ArrowRight className="size-3.5 text-zinc-500 opencanvas-handoff-arrow" />
        <PhasePill label={toLabel} tint={toTint} />
        <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">
          handoff
        </span>
      </div>
      <p className="text-[13px] text-zinc-200 leading-relaxed pl-1">
        {message}
      </p>
    </motion.div>
  );
}

function PhasePill({
  label,
  tint,
  done,
}: {
  label: string;
  tint: string;
  done?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-semibold tracking-wide"
      style={{
        background: `color-mix(in oklab, ${tint} 18%, transparent)`,
        border: `1px solid color-mix(in oklab, ${tint} 35%, transparent)`,
        color: tint,
      }}
    >
      {done && <Check className="size-2.5" strokeWidth={3} />}
      {label}
    </span>
  );
}
