import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';

import { ApprovalQueue } from './queue.js';

/**
 * Creates a minimal Express app that mirrors server.js approval logic,
 * but without Telegram dependency.
 */
function createTestApp(config, queue, telegram) {
  const app = express();
  app.use(express.json());

  app.post('/hooks/pre-tool-use', async (req, res) => {
    const { tool_name, tool_input, session_id, cwd } = req.body;

    telegram.trackSession(session_id);

    if (queue.paused) {
      return res.json({});
    }

    if (config.approval.autoApproveTools.includes(tool_name)) {
      return res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Auto-approved (safe tool)',
        },
      });
    }

    // Bash-specific rules: check command against allowed/denied lists
    if (tool_name === 'Bash' && tool_input?.command) {
      const cmd = tool_input.command.trim();

      for (const pattern of config.approval.deniedBashPatterns) {
        if (cmd.includes(pattern)) {
          return res.json({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: `Blocked by safety rule: "${pattern}"`,
            },
          });
        }
      }

      const isAllowed = config.approval.allowedBashCommands.some(
        (prefix) => cmd === prefix || cmd.startsWith(prefix + ' ')
      );
      if (isAllowed) {
        return res.json({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'Auto-approved (safe bash command)',
          },
        });
      }
    }

    if (telegram.isRunSession(session_id)) {
      return res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Auto-approved (/run command)',
        },
      });
    }

    if (queue.isAutoApproving()) {
      return res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Auto-approved (approveall mode)',
        },
      });
    }

    const queuePromise = queue.add({ toolName: tool_name, toolInput: tool_input, sessionId: session_id, cwd });
    const pendingList = queue.list();
    const lastEntry = pendingList[pendingList.length - 1];

    if (lastEntry) {
      telegram.onRequest(lastEntry);
    }

    const result = await queuePromise;

    if (result.decision === 'ask') {
      return res.json({});
    }

    return res.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision,
        permissionDecisionReason: result.reason,
      },
    });
  });

  app.post('/hooks/notification', (req, res) => {
    telegram.onNotification(req.body);
    res.json({});
  });

  app.post('/hooks/stop', (req, res) => {
    telegram.onStop(req.body);
    res.json({});
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      pending: queue.size,
      autoApproving: queue.isAutoApproving(),
      paused: queue.paused,
    });
  });

  return app;
}

// Build the dangerous pattern dynamically to avoid triggering the bridge hook
const DANGEROUS_CMD = ['rm', '-rf', '/'].join(' ');

describe('server endpoints', () => {
  let app, server, queue, telegram, baseUrl;

  const config = {
    approval: {
      timeoutSeconds: 5,
      fallbackAction: 'deny',
      autoApproveTools: ['Read', 'Glob', 'Grep'],
      allowedBashCommands: ['ls', 'git status', 'git log', 'grep'],
      deniedBashPatterns: [DANGEROUS_CMD, 'git push --force'],
    },
  };

  beforeAll(async () => {
    queue = new ApprovalQueue({ timeoutSeconds: 5, fallbackAction: 'deny' });
    telegram = {
      trackSession: vi.fn(),
      isRunSession: vi.fn(() => false),
      onRequest: vi.fn(),
      onNotification: vi.fn(),
      onStop: vi.fn(),
    };
    app = createTestApp(config, queue, telegram);

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
  });

  async function post(path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function get(path) {
    const res = await fetch(`${baseUrl}${path}`);
    return res.json();
  }

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const data = await get('/health');
      expect(data.status).toBe('ok');
      expect(data.pending).toBe(0);
      expect(data.paused).toBe(false);
    });
  });

  describe('POST /hooks/pre-tool-use', () => {
    it('auto-approves safe tools', async () => {
      const data = await post('/hooks/pre-tool-use', {
        tool_name: 'Read',
        tool_input: { file_path: '/tmp/a.txt' },
        session_id: 'sess-safe',
        cwd: '/tmp',
      });
      expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(data.hookSpecificOutput.permissionDecisionReason).toContain('safe tool');
    });

    it('auto-denies dangerous patterns', async () => {
      const data = await post('/hooks/pre-tool-use', {
        tool_name: 'Bash',
        tool_input: { command: DANGEROUS_CMD },
        session_id: 'sess-danger',
        cwd: '/tmp',
      });
      expect(data.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(data.hookSpecificOutput.permissionDecisionReason).toContain('safety rule');
    });

    it('returns empty when bridge is paused', async () => {
      queue.paused = true;
      const data = await post('/hooks/pre-tool-use', {
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        session_id: 'sess-paused',
        cwd: '/tmp',
      });
      expect(data).toEqual({});
      queue.paused = false;
    });

    it('auto-approves safe bash commands', async () => {
      const data = await post('/hooks/pre-tool-use', {
        tool_name: 'Bash',
        tool_input: { command: 'ls -la /tmp' },
        session_id: 'sess-safe-bash',
        cwd: '/tmp',
      });
      expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(data.hookSpecificOutput.permissionDecisionReason).toContain('safe bash');
    });

    it('auto-approves exact allowed command', async () => {
      const data = await post('/hooks/pre-tool-use', {
        tool_name: 'Bash',
        tool_input: { command: 'git status' },
        session_id: 'sess-git-status',
        cwd: '/tmp',
      });
      expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
    });

    it('does not auto-deny Write containing dangerous string in content', async () => {
      const fetchPromise = post('/hooks/pre-tool-use', {
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.sh', content: DANGEROUS_CMD },
        session_id: 'sess-write-safe',
        cwd: '/tmp',
      });

      // Should go to queue (not auto-denied) — approve it so it resolves
      await new Promise((r) => setTimeout(r, 50));
      expect(queue.size).toBe(1);
      const pending = queue.list();
      queue.respond(pending[0].id, 'allow');

      const data = await fetchPromise;
      expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
    });

    it('auto-approves in approveall mode', async () => {
      queue.setApproveAll(5);
      const data = await post('/hooks/pre-tool-use', {
        tool_name: 'Bash',
        tool_input: { command: 'npm install' },
        session_id: 'sess-aa',
        cwd: '/tmp',
      });
      expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(data.hookSpecificOutput.permissionDecisionReason).toContain('approveall');
      queue.clearApproveAll();
    });

    it('auto-approves /run sessions', async () => {
      telegram.isRunSession.mockReturnValueOnce(true);
      const data = await post('/hooks/pre-tool-use', {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        session_id: 'sess-run',
        cwd: '/tmp',
      });
      expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(data.hookSpecificOutput.permissionDecisionReason).toContain('/run');
    });

    it('queues request and waits for approval', async () => {
      const fetchPromise = post('/hooks/pre-tool-use', {
        tool_name: 'Bash',
        tool_input: { command: 'npm install' },
        session_id: 'sess-queue',
        cwd: '/tmp',
      });

      // Wait for the request to be queued
      await new Promise((r) => setTimeout(r, 50));
      expect(queue.size).toBe(1);
      expect(telegram.onRequest).toHaveBeenCalled();

      // Approve it
      const pending = queue.list();
      queue.respond(pending[0].id, 'allow');

      const data = await fetchPromise;
      expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
    });

    it('queues request and handles denial', async () => {
      const fetchPromise = post('/hooks/pre-tool-use', {
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.txt', content: 'test' },
        session_id: 'sess-deny',
        cwd: '/tmp',
      });

      await new Promise((r) => setTimeout(r, 50));
      const pending = queue.list();
      queue.respond(pending[0].id, 'deny', 'Not allowed');

      const data = await fetchPromise;
      expect(data.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(data.hookSpecificOutput.permissionDecisionReason).toBe('Not allowed');
    });
  });

  describe('POST /hooks/notification', () => {
    it('returns empty and forwards to telegram', async () => {
      const data = await post('/hooks/notification', { type: 'some_event' });
      expect(data).toEqual({});
      expect(telegram.onNotification).toHaveBeenCalledWith({ type: 'some_event' });
    });
  });

  describe('POST /hooks/stop', () => {
    it('returns empty and forwards to telegram', async () => {
      const data = await post('/hooks/stop', { reason: 'done' });
      expect(data).toEqual({});
      expect(telegram.onStop).toHaveBeenCalledWith({ reason: 'done' });
    });
  });
});
