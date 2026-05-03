import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { providerEventsToUIMS, UIMS_HEADERS } from '../uims-stream.js';
import { parseCanvasSnapshot } from '../../agent/canvas-snapshot.js';
import type { CanvasSnapshot } from '../../agent/canvas-snapshot.js';
import type { ProviderEvent } from '../../core/provider.js';
import type { BackendState } from '../state.js';

/**
 * POST /v1/team — sequential multi-agent run.
 *
 * Three agents pass the canvas through a pipeline:
 *   1. Researcher: gather evidence from KB + web, place primary widgets
 *   2. Builder: synthesize what Researcher found, place detail widgets
 *   3. Critic: read everything, add reference widgets / flag gaps
 *
 * Each phase sees the cumulative canvas (its own snapshot field includes
 * widgets placed by earlier phases) so the agents genuinely build on
 * each other rather than three parallel silos.
 *
 * Output streams to the client as a single useChat-compatible message
 * with a phase header text-delta between phases. The `outer: 'step-only'`
 * forwarder handles per-phase brackets; this route emits the outer
 * start/finish/[DONE].
 */
type ContentBlock = { type: string; text?: string };
type UIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ContentBlock[];
  parts?: ContentBlock[];
};

function extractText(message: UIChatMessage): string {
  const blocks = message.parts ?? message.content;
  if (typeof blocks === 'string') return blocks;
  if (Array.isArray(blocks)) {
    return blocks
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('');
  }
  return '';
}

const PHASES = [
  {
    role: 'research' as const,
    label: '🔬 Researcher',
    systemPrompt: `You are the RESEARCH agent in a 3-agent team (Researcher → Builder → Critic).

Your job: gather raw evidence from the KB and web. Place 1-3 widgets summarizing what you find — markdown for prose, table for structured data. Use role: "primary" on every place_widget call (your widgets are the foundation the team builds on).

Be tight: 1-2 search calls + 1-3 placements + a one-line text reply. The Builder will synthesize next, so don't over-explain. If the topic isn't in the KB, web_search and say so.`,
  },
  {
    role: 'build' as const,
    label: '🛠 Builder',
    systemPrompt: `You are the BUILDER agent. The Researcher just placed widgets on the canvas — read them via read_canvas / read_widget before doing anything else.

Your job: synthesize the research into something concrete. Place 1-2 widgets — code-block for code, key-value-card for comparisons, markdown for guides. Use role: "detail" on every place_widget call.

Don't repeat the Researcher's findings — extend them. Reply with one short sentence pointing to what you built.`,
  },
  {
    role: 'review' as const,
    label: '🔍 Critic',
    systemPrompt: `You are the CRITIC agent. The Researcher and Builder have done their work — read the canvas first.

Your job: flag gaps, add citation widgets, point out caveats or risks. Place 0-2 widgets with role: "reference" (web-embed for citations; markdown for caveats; key-value-card for a "Review notes" summary). Be terse — if everything looks solid, just place a single key-value-card titled "Review notes" with one or two key/value pairs and reply "looks solid".`,
  },
];

export function teamRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/team', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      messages?: UIChatMessage[];
      canvasSnapshot?: unknown;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages must be a non-empty array' }, 400);
    }
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      return c.json({ error: 'at least one user message is required' }, 400);
    }
    const userPrompt = extractText(lastUser);
    if (!userPrompt.trim()) {
      return c.json({ error: 'last user message has no text content' }, 400);
    }

    const initialSnapshot = parseCanvasSnapshot(body.canvasSnapshot);

    for (const [k, v] of Object.entries(UIMS_HEADERS)) c.header(k, v);

    return stream(c, async (s) => {
      const abortController = new AbortController();
      c.req.raw.signal.addEventListener(
        'abort',
        () => abortController.abort(),
        { once: true },
      );

      // Outer frame — emitted ONCE for the whole team run so useChat sees
      // a single assistant message regardless of how many phases ran.
      const messageId = `team-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await s.write(
        `data: ${JSON.stringify({ type: 'start', messageId })}\n\n`,
      );

      const provider = state.getLLMProvider();
      let accumulatedSnapshot: CanvasSnapshot = initialSnapshot;

      // Helper to emit a custom data part the frontend uses to drive a
      // visible "team progress" timeline. UIMS chunk type
      // `data-team-phase` is surfaced by useChat as a parsed part and we
      // pull it out client-side. Status: 'start' | 'complete'.
      const emitPhaseSignal = async (
        agent: string,
        status: 'start' | 'complete',
      ) => {
        await s.write(
          `data: ${JSON.stringify({
            type: 'data-team-phase',
            id: `phase-${agent}-${status}`,
            data: { agent, status },
          })}\n\n`,
        );
      };

      try {
        for (let i = 0; i < PHASES.length; i++) {
          const phase = PHASES[i]!;
          // Signal phase start so the timeline can light up the right dot
          // BEFORE the agent's tool calls + text start streaming.
          await emitPhaseSignal(phase.role, 'start');

          // Phase header — visible separator in the chat for the user.
          // Use a unique text-id per phase so useChat doesn't merge them.
          const phaseTextId = `t-${phase.role}`;
          await s.write(
            `data: ${JSON.stringify({ type: 'text-start', id: phaseTextId })}\n\n`,
          );
          const headerText = i === 0 ? `## ${phase.label}\n\n` : `\n\n---\n\n## ${phase.label}\n\n`;
          await s.write(
            `data: ${JSON.stringify({ type: 'text-delta', id: phaseTextId, delta: headerText })}\n\n`,
          );
          await s.write(
            `data: ${JSON.stringify({ type: 'text-end', id: phaseTextId })}\n\n`,
          );

          // Run this phase's SDK call. Each phase gets the snapshot that
          // includes prior phases' placements — that's the team handoff.
          const events = provider.query({
            prompt: userPrompt,
            systemPrompt: phase.systemPrompt,
            canvasSnapshot: accumulatedSnapshot,
            abortSignal: abortController.signal,
          });

          // Tap the event stream: forward to UIMS AND collect place_widget
          // directives so the next phase can see them.
          const placedWidgets: CanvasSnapshot['widgets'] = [];
          const tapped = tapForPlacements(events, (w) => placedWidgets.push(w));

          for await (const sseLine of providerEventsToUIMS(tapped, {
            outer: 'step-only',
            textId: `t-body-${phase.role}`,
            reasoningId: `r-${phase.role}`,
          })) {
            await s.write(sseLine);
          }

          // Add this phase's placements to the cumulative snapshot.
          accumulatedSnapshot = {
            ...accumulatedSnapshot,
            widgets: [...accumulatedSnapshot.widgets, ...placedWidgets],
          };

          await emitPhaseSignal(phase.role, 'complete');

          if (abortController.signal.aborted) break;
        }

        await s.write(
          `data: ${JSON.stringify({ type: 'finish', finishReason: 'stop' })}\n\n`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[team] orchestration error:', message);
        await s.write(
          `data: ${JSON.stringify({ type: 'error', errorText: message })}\n\n`,
        );
        await s.write(
          `data: ${JSON.stringify({ type: 'finish', finishReason: 'error' })}\n\n`,
        );
      }

      await s.write('data: [DONE]\n\n');
    });
  });

  return r;
}

/**
 * Watch a ProviderEvent stream for `tool-result` events that look like
 * place_widget directives, and call `onPlace` with the widget shape so
 * the orchestrator can accumulate cross-phase canvas state.
 *
 * Pure passthrough — every original event is yielded unchanged.
 */
async function* tapForPlacements(
  events: AsyncIterable<ProviderEvent>,
  onPlace: (w: CanvasSnapshot['widgets'][number]) => void,
): AsyncIterable<ProviderEvent> {
  for await (const ev of events) {
    if (
      ev.type === 'tool-result' &&
      !ev.isError &&
      ev.name.endsWith('place_widget')
    ) {
      const parsed = parsePlaceDirective(ev.output);
      if (parsed) onPlace(parsed);
    }
    yield ev;
  }
}

function parsePlaceDirective(
  output: unknown,
): CanvasSnapshot['widgets'][number] | null {
  let value: unknown = output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('directive' in value)
  ) {
    return null;
  }
  const d = (value as { directive: unknown }).directive;
  if (
    typeof d !== 'object' ||
    d === null ||
    (d as { type?: unknown }).type !== 'place'
  ) {
    return null;
  }
  const dd = d as {
    id: string;
    kind: string;
    role: string;
    payload: Record<string, unknown>;
  };
  // Cast: the union types narrow at the agent/types boundary, not here.
  return {
    id: dd.id,
    kind: dd.kind as never,
    role: dd.role as never,
    title: (dd.payload['title'] as string) ?? dd.id,
    payload: dd.payload,
  };
}
