import { motion, AnimatePresence } from 'framer-motion';
import type { UIMessage } from 'ai';

/**
 * Step picked off the live conversation state. Highest-priority signal
 * wins — see deriveStep below.
 */
export type LiveStep = {
  /** Stable key that suppresses re-mount when only the label refines. */
  key: string;
  /** Single emoji rendered ahead of the label. */
  emoji: string;
  label: string;
};

/**
 * Inline variant — rendered INSIDE the latest streaming assistant
 * message body so live progress reads as part of the conversation
 * rather than as a separate floating pill. Smaller chrome (no gradient
 * border, no breathing animation) so it sits naturally between
 * text-deltas and tool-call indicators.
 */
export function InlineLiveStep({
  step,
}: {
  step: LiveStep | null;
}) {
  return (
    <AnimatePresence mode="wait">
      {step && (
        <motion.div
          key={step.key}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.16 }}
          className="opencanvas-inline-step"
          role="status"
          aria-live="polite"
        >
          <span className="opencanvas-inline-step-emoji" aria-hidden>
            {step.emoji}
          </span>
          <span className="opencanvas-inline-step-label">{step.label}</span>
          <span className="opencanvas-live-status-dots" aria-hidden>
            <span /><span /><span />
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Renders an inline status pill ABOVE the chat composer that updates as
 * the agent moves through phases. Replaces the previous flat "thinking…"
 * indicator with something that tracks what's actually happening.
 *
 * Now unused by Chat.tsx (the inline variant lives in the message body
 * instead), but exported in case external surfaces want it.
 */
export function LiveStatus({
  step,
}: {
  step: LiveStep | null;
}) {
  return (
    <AnimatePresence mode="wait">
      {step && (
        <motion.div
          key={step.key}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.18 }}
          className="opencanvas-live-status"
          role="status"
          aria-live="polite"
        >
          <span className="opencanvas-live-status-emoji" aria-hidden>
            {step.emoji}
          </span>
          <span className="opencanvas-live-status-label">{step.label}</span>
          <span className="opencanvas-live-status-dots" aria-hidden>
            <span /><span /><span />
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type ToolPart = {
  type: string;
  state?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
};

function isToolPart(p: { type: string }): p is ToolPart {
  return p.type === 'dynamic-tool' || p.type.startsWith('tool-');
}

function toolDisplayName(p: ToolPart): string {
  if (p.type === 'dynamic-tool') return p.toolName ?? 'tool';
  // tool-mcp__opencanvas__search_kb → search_kb
  const raw = p.type.slice('tool-'.length);
  const last = raw.split('__').pop();
  return last && last.length > 0 ? last : raw;
}

const TOOL_EMOJI: Record<string, string> = {
  search_kb: '📚',
  fetch_result: '📄',
  web_search: '🌐',
  place_widget: '🎨',
  update_widget: '✏️',
  read_canvas: '🗺️',
  read_widget: '🔎',
  focus_widget: '🎯',
  link_widgets: '🔗',
  clear_canvas: '🧹',
  switch_template: '🪄',
};

const TOOL_VERB: Record<string, string> = {
  search_kb: 'Searching your knowledge base',
  fetch_result: 'Fetching full payload',
  web_search: 'Searching the web',
  place_widget: 'Placing a widget',
  update_widget: 'Updating a widget',
  read_canvas: 'Reading the canvas',
  read_widget: 'Reading widget detail',
  focus_widget: 'Focusing a widget',
  link_widgets: 'Linking widgets',
  clear_canvas: 'Clearing the canvas',
  switch_template: 'Switching template',
};

/**
 * Derive the most informative live step from the conversation state.
 *
 * Priority (highest → lowest):
 *   1. Local KB search is busy   → "Searching your knowledge base…"
 *   2. Latest assistant message has an in-flight tool call
 *      (state input-streaming / input-available with no output yet)
 *      → "{tool-verb}…" with the tool's input snippet
 *   3. Latest assistant message just got a tool output
 *      → flash the result for a beat ("Found N matches", "Placed kind")
 *   4. Latest assistant message is streaming text
 *      → "Writing reply…"
 *   5. Submitted but nothing yet                    → "Thinking…"
 *   6. Idle                                         → null (nothing rendered)
 */
export function deriveStep(input: {
  isStreaming: boolean;
  kbBusy: boolean;
  messages: UIMessage[];
}): LiveStep | null {
  const { isStreaming, kbBusy, messages } = input;
  // Look at the most recent assistant message — that's where streaming
  // tool calls land.
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant') as
    | { id: string; parts: Array<{ type: string }> }
    | undefined;

  if (kbBusy) {
    return {
      key: 'kb-busy',
      emoji: '📚',
      label: 'Searching your knowledge base',
    };
  }

  if (lastAssistant) {
    const toolParts = lastAssistant.parts.filter(isToolPart);
    // Find an in-flight tool call (no output yet).
    const active = [...toolParts].reverse().find(
      (p) =>
        p.state === 'input-streaming' ||
        p.state === 'input-available' ||
        p.state === 'partial-call' ||
        p.state === 'call',
    );
    if (active) {
      const name = toolDisplayName(active);
      const emoji = TOOL_EMOJI[name] ?? '🛠️';
      const verb = TOOL_VERB[name] ?? `Calling ${name}`;
      const detail = describeToolInput(name, active.input);
      return {
        key: `tool-${name}-${(active as { toolCallId?: string }).toolCallId ?? ''}`,
        emoji,
        label: detail ? `${verb}: ${detail}` : verb,
      };
    }
    // Recently-completed tool — surface a one-line result hint while text
    // streams. We only do this if the LAST tool part is output-available
    // (so we don't keep flashing old results once new text starts).
    const lastTool = toolParts[toolParts.length - 1];
    if (
      lastTool &&
      (lastTool.state === 'output-available' || lastTool.state === 'result') &&
      isStreaming
    ) {
      const name = toolDisplayName(lastTool);
      const summary = summariseToolOutput(name, lastTool.output);
      if (summary) {
        return {
          key: `tool-result-${name}-${(lastTool as { toolCallId?: string }).toolCallId ?? ''}`,
          emoji: TOOL_EMOJI[name] ?? '✅',
          label: summary,
        };
      }
    }
    // No tool active and message has at least one text part → reply is being written.
    const hasText = lastAssistant.parts.some(
      (p) => p.type === 'text' || p.type === 'reasoning',
    );
    if (hasText && isStreaming) {
      return { key: 'writing', emoji: '✍️', label: 'Writing reply' };
    }
  }

  if (isStreaming) {
    return { key: 'thinking', emoji: '💭', label: 'Thinking' };
  }
  return null;
}

function describeToolInput(name: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const pick = (k: string) => (typeof obj[k] === 'string' ? (obj[k] as string) : undefined);
  switch (name) {
    case 'search_kb':
      return truncate(pick('query'));
    case 'web_search':
      return truncate(pick('query'));
    case 'fetch_result':
      return truncate(pick('id'));
    case 'place_widget': {
      const kind = pick('kind');
      const role = pick('role');
      if (kind && role) return `${kind} (${role})`;
      return kind ?? null;
    }
    case 'update_widget':
      return truncate(pick('id'));
    case 'read_widget':
    case 'focus_widget':
      return truncate(pick('id'));
    case 'switch_template':
      return truncate(pick('id'));
    default:
      return null;
  }
}

function summariseToolOutput(name: string, output: unknown): string | null {
  if (output === null || output === undefined) return null;
  // Tool outputs come through as JSON-serialised strings or objects depending
  // on the SDK; normalise.
  let value: unknown = output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      // Plain string — show a short preview.
      return `Got ${truncate(value as string, 60)}`;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;

  switch (name) {
    case 'search_kb': {
      const results = obj['results'];
      if (Array.isArray(results)) return `Found ${results.length} match${results.length === 1 ? '' : 'es'}`;
      return null;
    }
    case 'web_search': {
      const results = obj['results'];
      if (Array.isArray(results)) return `Found ${results.length} web hit${results.length === 1 ? '' : 's'}`;
      return null;
    }
    case 'place_widget': {
      const directive = obj['directive'] as { kind?: string } | undefined;
      if (directive?.kind) return `Placed ${directive.kind}`;
      return 'Placed';
    }
    case 'update_widget':
      return 'Updated widget';
    case 'fetch_result':
      return 'Fetched payload';
    case 'read_canvas': {
      const widgets = obj['widgets'];
      if (Array.isArray(widgets)) return `Read canvas (${widgets.length} widget${widgets.length === 1 ? '' : 's'})`;
      return null;
    }
    default:
      return null;
  }
}

function truncate(text: string | undefined, max = 50): string | null {
  if (!text) return null;
  const t = text.trim();
  if (t.length === 0) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
