import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';

export type Schedule = {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  conversationId: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  createdAt: number;
};

const DEFAULT_STORAGE_PATH = path.join(os.homedir(), '.opencanvas', 'schedules.json');
const POLL_INTERVAL_MS = 30_000;

export class AgentScheduler {
  private schedules = new Map<string, Schedule>();
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param chatBaseUrl  Base URL for the backend. Production: 'http://127.0.0.1:3457'.
   *                     Tests inject a mock URL.
   * @param storagePath  Path to schedules.json. Defaults to ~/.opencanvas/schedules.json.
   *                     Tests inject a temp path to avoid polluting user state.
   */
  constructor(
    private readonly chatBaseUrl: string,
    private readonly storagePath: string = DEFAULT_STORAGE_PATH,
  ) {}

  async init(): Promise<void> {
    const loaded = await this.load();
    for (const s of loaded) {
      // Recompute nextRun in case the server was offline for a while.
      s.nextRun = this.computeNextRun(s.cron);
      this.schedules.set(s.id, s);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) =>
        console.error('[AgentScheduler] tick error:', e),
      );
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  list(): Schedule[] {
    return Array.from(this.schedules.values());
  }

  get(id: string): Schedule | undefined {
    return this.schedules.get(id);
  }

  async create(
    input: Omit<Schedule, 'id' | 'createdAt' | 'nextRun'>,
  ): Promise<Schedule> {
    // Validate cron — CronExpressionParser.parse throws on invalid input.
    const nextRun = this.computeNextRun(input.cron);
    const schedule: Schedule = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now(),
      nextRun,
    };
    this.schedules.set(schedule.id, schedule);
    await this.persist();
    return schedule;
  }

  async update(
    id: string,
    patch: Partial<Schedule>,
  ): Promise<Schedule | undefined> {
    const existing = this.schedules.get(id);
    if (!existing) return undefined;

    const updated: Schedule = { ...existing, ...patch, id };
    // If cron changed, recompute nextRun.
    if (patch.cron && patch.cron !== existing.cron) {
      updated.nextRun = this.computeNextRun(updated.cron);
    }
    this.schedules.set(id, updated);
    await this.persist();
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.schedules.delete(id);
    if (existed) await this.persist();
    return existed;
  }

  async runNow(id: string): Promise<boolean> {
    const s = this.schedules.get(id);
    if (!s) return false;
    await this.dispatch(s);
    return true;
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const s of this.schedules.values()) {
      if (!s.enabled) continue;
      if (!s.nextRun || s.nextRun <= now) {
        await this.dispatch(s);
      }
    }
  }

  private async dispatch(schedule: Schedule): Promise<void> {
    const url = `${this.chatBaseUrl}/v1/chat`;
    const body = JSON.stringify({
      messages: [{ role: 'user', content: schedule.prompt }],
      conversationId: schedule.conversationId,
    });
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      // Drain the stream so the agent completes; side effects
      // (widget placement via canvas event bus) are what matter.
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } catch (e) {
      console.error(
        `[AgentScheduler] dispatch failed for schedule "${schedule.name}" (${schedule.id}):`,
        e,
      );
    }
    schedule.lastRun = Date.now();
    schedule.nextRun = this.computeNextRun(schedule.cron);
    await this.persist();
  }

  private computeNextRun(cron: string): number {
    // CronExpressionParser.parse throws on invalid expressions.
    const it = CronExpressionParser.parse(cron);
    return it.next().toDate().getTime();
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const arr = Array.from(this.schedules.values());
    await fs.writeFile(
      this.storagePath,
      JSON.stringify(arr, null, 2),
      'utf8',
    );
  }

  private async load(): Promise<Schedule[]> {
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      return JSON.parse(raw) as Schedule[];
    } catch {
      return [];
    }
  }
}
