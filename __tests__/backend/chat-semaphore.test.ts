import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createChatSemaphore,
  leaseFrom,
  getProcessChatSemaphore,
  __resetProcessChatSemaphoreForTests,
} from '../../src/backend/chat-semaphore.js';

describe('chat-semaphore', () => {
  it('allows acquires up to capacity', () => {
    const s = createChatSemaphore(3);
    expect(s.tryAcquire()).toBe(true);
    expect(s.tryAcquire()).toBe(true);
    expect(s.tryAcquire()).toBe(true);
    expect(s.inFlight()).toBe(3);
    expect(s.tryAcquire()).toBe(false);
    expect(s.inFlight()).toBe(3);
  });

  it('release frees a slot for re-acquisition', () => {
    const s = createChatSemaphore(2);
    s.tryAcquire();
    s.tryAcquire();
    expect(s.tryAcquire()).toBe(false);
    s.release();
    expect(s.inFlight()).toBe(1);
    expect(s.tryAcquire()).toBe(true);
  });

  it('release below zero is clamped', () => {
    const s = createChatSemaphore(2);
    s.release(); // no acquire yet
    s.release();
    expect(s.inFlight()).toBe(0);
    expect(s.tryAcquire()).toBe(true);
  });

  it('capacity <= 0 disables the semaphore (everything passes)', () => {
    const s = createChatSemaphore(0);
    for (let i = 0; i < 100; i++) expect(s.tryAcquire()).toBe(true);
    expect(s.inFlight()).toBe(0); // disabled = no tracking
    s.release(); // no-op, shouldn't throw
  });

  it('reports configured capacity', () => {
    expect(createChatSemaphore(7).capacity()).toBe(7);
    expect(createChatSemaphore(0).capacity()).toBe(0);
  });

  describe('leaseFrom', () => {
    it('release is idempotent — second call is a no-op', () => {
      const s = createChatSemaphore(2);
      s.tryAcquire();
      const lease = leaseFrom(s);
      expect(s.inFlight()).toBe(1);
      lease.release();
      expect(s.inFlight()).toBe(0);
      expect(lease.released).toBe(true);
      lease.release(); // second call must not double-decrement
      expect(s.inFlight()).toBe(0);
    });
  });

  describe('getProcessChatSemaphore', () => {
    beforeEach(() => {
      __resetProcessChatSemaphoreForTests();
      delete process.env['OPENCANVAS_CHAT_MAX_CONCURRENT'];
    });
    afterEach(() => {
      __resetProcessChatSemaphoreForTests();
      delete process.env['OPENCANVAS_CHAT_MAX_CONCURRENT'];
    });

    it('defaults to capacity 10 when env unset', () => {
      const s = getProcessChatSemaphore();
      expect(s.capacity()).toBe(10);
    });

    it('honors OPENCANVAS_CHAT_MAX_CONCURRENT', () => {
      process.env['OPENCANVAS_CHAT_MAX_CONCURRENT'] = '3';
      const s = getProcessChatSemaphore();
      expect(s.capacity()).toBe(3);
    });

    it('falls back to default when env is non-numeric', () => {
      process.env['OPENCANVAS_CHAT_MAX_CONCURRENT'] = 'not-a-number';
      const s = getProcessChatSemaphore();
      expect(s.capacity()).toBe(10);
    });

    it('returns the same instance across calls', () => {
      const a = getProcessChatSemaphore();
      const b = getProcessChatSemaphore();
      expect(a).toBe(b);
    });
  });
});
