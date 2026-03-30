import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalQueue } from './queue.js';

describe('ApprovalQueue', () => {
  let queue;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new ApprovalQueue({ timeoutSeconds: 10, fallbackAction: 'deny' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('uses provided options', () => {
      expect(queue.timeoutSeconds).toBe(10);
      expect(queue.fallbackAction).toBe('deny');
      expect(queue.paused).toBe(false);
      expect(queue.size).toBe(0);
    });

    it('uses defaults when no options given', () => {
      const q = new ApprovalQueue();
      expect(q.timeoutSeconds).toBe(300);
      expect(q.fallbackAction).toBe('ask');
    });
  });

  describe('add and respond', () => {
    it('adds a request and resolves on approve', async () => {
      const promise = queue.add({ toolName: 'Bash', toolInput: { command: 'ls' }, sessionId: 's1', cwd: '/tmp' });
      expect(queue.size).toBe(1);

      const pending = queue.list();
      expect(pending).toHaveLength(1);
      expect(pending[0].toolName).toBe('Bash');

      const id = pending[0].id;
      queue.respond(id, 'allow');

      const result = await promise;
      expect(result.decision).toBe('allow');
      expect(result.reason).toBe('Approved remotely');
      expect(result.timedOut).toBe(false);
      expect(queue.size).toBe(0);
    });

    it('adds a request and resolves on deny', async () => {
      const promise = queue.add({ toolName: 'Edit', toolInput: {}, sessionId: 's1', cwd: '/tmp' });
      const id = queue.list()[0].id;
      queue.respond(id, 'deny');

      const result = await promise;
      expect(result.decision).toBe('deny');
      expect(result.reason).toBe('Denied remotely');
    });

    it('uses custom reason when provided', async () => {
      const promise = queue.add({ toolName: 'Bash', toolInput: {}, sessionId: 's1', cwd: '/tmp' });
      const id = queue.list()[0].id;
      queue.respond(id, 'allow', 'Bulk approved');

      const result = await promise;
      expect(result.reason).toBe('Bulk approved');
    });

    it('returns false when responding to non-existent id', () => {
      expect(queue.respond('nonexistent', 'allow')).toBe(false);
    });
  });

  describe('timeout', () => {
    it('resolves with fallback action after timeout', async () => {
      const promise = queue.add({ toolName: 'Bash', toolInput: {}, sessionId: 's1', cwd: '/tmp' });
      expect(queue.size).toBe(1);

      vi.advanceTimersByTime(10_000);

      const result = await promise;
      expect(result.decision).toBe('deny');
      expect(result.timedOut).toBe(true);
      expect(result.reason).toContain('Timeout after 10s');
      expect(queue.size).toBe(0);
    });

    it('uses ask as fallback when configured', async () => {
      const q = new ApprovalQueue({ timeoutSeconds: 5, fallbackAction: 'ask' });
      const promise = q.add({ toolName: 'Bash', toolInput: {}, sessionId: 's1', cwd: '/tmp' });

      vi.advanceTimersByTime(5_000);

      const result = await promise;
      expect(result.decision).toBe('ask');
    });
  });

  describe('get', () => {
    it('returns entry data without resolve/timer', () => {
      queue.add({ toolName: 'Write', toolInput: { file_path: '/a.js' }, sessionId: 's2', cwd: '/home' });
      const id = queue.list()[0].id;
      const entry = queue.get(id);

      expect(entry).toMatchObject({
        id,
        toolName: 'Write',
        toolInput: { file_path: '/a.js' },
        sessionId: 's2',
        cwd: '/home',
      });
      expect(entry).toHaveProperty('createdAt');
      expect(entry).not.toHaveProperty('resolve');
      expect(entry).not.toHaveProperty('timer');
    });

    it('returns null for unknown id', () => {
      expect(queue.get('nope')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all pending with age', () => {
      queue.add({ toolName: 'Bash', toolInput: {}, sessionId: 's1', cwd: '/' });
      vi.advanceTimersByTime(3000);
      queue.add({ toolName: 'Edit', toolInput: {}, sessionId: 's2', cwd: '/' });

      const list = queue.list();
      expect(list).toHaveLength(2);
      expect(list[0].toolName).toBe('Bash');
      expect(list[0].age).toBe(3);
      expect(list[1].toolName).toBe('Edit');
      expect(list[1].age).toBe(0);
    });
  });

  describe('approveAllPending', () => {
    it('approves all pending requests', async () => {
      const p1 = queue.add({ toolName: 'Bash', toolInput: {}, sessionId: 's1', cwd: '/' });
      const p2 = queue.add({ toolName: 'Edit', toolInput: {}, sessionId: 's2', cwd: '/' });
      expect(queue.size).toBe(2);

      const count = queue.approveAllPending();
      expect(count).toBe(2);
      expect(queue.size).toBe(0);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.decision).toBe('allow');
      expect(r2.decision).toBe('allow');
      expect(r1.reason).toBe('Bulk approved remotely');
    });

    it('returns 0 when queue is empty', () => {
      expect(queue.approveAllPending()).toBe(0);
    });
  });

  describe('denyAllPending', () => {
    it('denies all pending requests', async () => {
      const p1 = queue.add({ toolName: 'Bash', toolInput: {}, sessionId: 's1', cwd: '/' });
      const p2 = queue.add({ toolName: 'Write', toolInput: {}, sessionId: 's2', cwd: '/' });

      const count = queue.denyAllPending();
      expect(count).toBe(2);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.decision).toBe('deny');
      expect(r2.decision).toBe('deny');
    });
  });

  describe('auto-approve mode', () => {
    it('is not auto-approving by default', () => {
      expect(queue.isAutoApproving()).toBe(false);
    });

    it('enables auto-approve for N minutes', () => {
      queue.setApproveAll(5);
      expect(queue.isAutoApproving()).toBe(true);
    });

    it('expires after the set duration', () => {
      queue.setApproveAll(1); // 1 minute
      expect(queue.isAutoApproving()).toBe(true);

      vi.advanceTimersByTime(60_001);
      expect(queue.isAutoApproving()).toBe(false);
    });

    it('clears auto-approve manually', () => {
      queue.setApproveAll(30);
      expect(queue.isAutoApproving()).toBe(true);

      queue.clearApproveAll();
      expect(queue.isAutoApproving()).toBe(false);
    });
  });

  describe('paused', () => {
    it('defaults to false', () => {
      expect(queue.paused).toBe(false);
    });

    it('can be toggled', () => {
      queue.paused = true;
      expect(queue.paused).toBe(true);
      queue.paused = false;
      expect(queue.paused).toBe(false);
    });
  });
});
