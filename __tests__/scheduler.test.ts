import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentScheduler } from '../src/backend/agent-scheduler.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'oc-sched-test-'));
  // Mock fetch globally so dispatch doesn't hit the network.
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    body: {
      getReader: () => ({
        read: vi.fn().mockResolvedValue({ done: true }),
      }),
    },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

function makeScheduler() {
  return new AgentScheduler(
    'http://localhost:3457',
    join(tempDir, 'schedules.json'),
  );
}

describe('AgentScheduler', () => {
  it('creates a schedule with computed nextRun from cron', async () => {
    const s = makeScheduler();
    await s.init();
    const created = await s.create({
      name: 'Test',
      cron: '0 9 * * 1',
      prompt: 'hello',
      conversationId: 'conv-1',
      enabled: true,
    });
    expect(created.id).toBeDefined();
    expect(created.nextRun).toBeGreaterThan(Date.now());
  });

  it('rejects invalid cron at create time', async () => {
    const s = makeScheduler();
    await s.init();
    await expect(
      s.create({
        name: 't',
        cron: 'not-a-cron',
        prompt: 'p',
        conversationId: 'c',
        enabled: true,
      }),
    ).rejects.toThrow();
  });

  it('runNow dispatches via fetch immediately', async () => {
    const s = makeScheduler();
    await s.init();
    const created = await s.create({
      name: 'T',
      cron: '* * * * *',
      prompt: 'go',
      conversationId: 'c',
      enabled: true,
    });
    await s.runNow(created.id);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3457/v1/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('disabled schedules are not dispatched on tick', async () => {
    const s = makeScheduler();
    await s.init();
    await s.create({
      name: 'D',
      cron: '* * * * *',
      prompt: 'p',
      conversationId: 'c',
      enabled: false,
    });
    // Access private tick via cast for unit testing.
    await (s as unknown as { tick(): Promise<void> }).tick();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('update + remove work', async () => {
    const s = makeScheduler();
    await s.init();
    const created = await s.create({
      name: 'A',
      cron: '0 9 * * *',
      prompt: 'p',
      conversationId: 'c',
      enabled: true,
    });
    const updated = await s.update(created.id, { name: 'B' });
    expect(updated?.name).toBe('B');
    expect(await s.remove(created.id)).toBe(true);
    expect(s.get(created.id)).toBeUndefined();
  });

  it('runNow returns false for unknown id', async () => {
    const s = makeScheduler();
    await s.init();
    expect(await s.runNow('does-not-exist')).toBe(false);
  });

  it('schedules persist across reload', async () => {
    const storagePath = join(tempDir, 'schedules.json');
    const s1 = new AgentScheduler('http://localhost:3457', storagePath);
    await s1.init();
    const created = await s1.create({
      name: 'Persist me',
      cron: '0 0 * * *',
      prompt: 'wake up',
      conversationId: 'conv-x',
      enabled: true,
    });

    // Boot a second scheduler with the same storage path.
    const s2 = new AgentScheduler('http://localhost:3457', storagePath);
    await s2.init();
    const loaded = s2.get(created.id);
    expect(loaded?.name).toBe('Persist me');
  });

  it('enabled schedule with past nextRun is dispatched on tick', async () => {
    const s = makeScheduler();
    await s.init();
    const created = await s.create({
      name: 'Due',
      cron: '* * * * *',
      prompt: 'tick',
      conversationId: 'c',
      enabled: true,
    });
    // Force nextRun into the past.
    await s.update(created.id, { nextRun: Date.now() - 1_000 });
    await (s as unknown as { tick(): Promise<void> }).tick();
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
