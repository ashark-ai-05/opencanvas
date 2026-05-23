import { Hono } from 'hono';
import type { BackendState } from '../state.js';

/**
 * /v1/schedules — CRUD + run-now for cron-driven agent schedules.
 *
 * All mutations delegate to AgentScheduler (held in BackendState).
 * Cron validation is handled by the scheduler — invalid expressions
 * throw, which we catch and surface as 400.
 */
export function schedulesRoute(state: BackendState): Hono {
  const r = new Hono();

  // GET /v1/schedules → { schedules: Schedule[] }
  r.get('/v1/schedules', (c) => {
    const scheduler = state.getAgentScheduler();
    return c.json({ schedules: scheduler.list() });
  });

  // POST /v1/schedules → create. Body: { name, cron, prompt, conversationId, enabled? }
  r.post('/v1/schedules', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      cron?: string;
      prompt?: string;
      conversationId?: string;
      enabled?: boolean;
    };

    if (!body.name || !body.cron || !body.prompt || !body.conversationId) {
      return c.json(
        { error: 'name, cron, prompt, and conversationId are required' },
        400,
      );
    }

    const scheduler = state.getAgentScheduler();
    try {
      const schedule = await scheduler.create({
        name: body.name,
        cron: body.cron,
        prompt: body.prompt,
        conversationId: body.conversationId,
        enabled: body.enabled ?? true,
      });
      return c.json(schedule, 201);
    } catch (e) {
      return c.json(
        { error: `Invalid cron expression: ${e instanceof Error ? e.message : String(e)}` },
        400,
      );
    }
  });

  // PUT /v1/schedules/:id → update (partial patch). Returns updated schedule.
  r.put('/v1/schedules/:id', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const scheduler = state.getAgentScheduler();
    try {
      const updated = await scheduler.update(id, body);
      if (!updated) return c.json({ error: 'Schedule not found' }, 404);
      return c.json(updated);
    } catch (e) {
      return c.json(
        { error: `Invalid cron expression: ${e instanceof Error ? e.message : String(e)}` },
        400,
      );
    }
  });

  // DELETE /v1/schedules/:id → { ok: true }
  r.delete('/v1/schedules/:id', async (c) => {
    const id = c.req.param('id');
    const scheduler = state.getAgentScheduler();
    const removed = await scheduler.remove(id);
    if (!removed) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ ok: true });
  });

  // POST /v1/schedules/:id/run → fire immediately regardless of nextRun
  r.post('/v1/schedules/:id/run', async (c) => {
    const id = c.req.param('id');
    const scheduler = state.getAgentScheduler();
    const ok = await scheduler.runNow(id);
    if (!ok) return c.json({ error: 'Schedule not found' }, 404);
    return c.json({ ok: true });
  });

  return r;
}
