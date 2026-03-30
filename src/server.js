import express from 'express';
import { spawn } from 'child_process';
import { ApprovalQueue } from './queue.js';
import { TelegramBridge } from './telegram.js';
import { loadConfig, savePid } from './config.js';

/**
 * Bridge server that:
 * 1. Receives Claude Code hook HTTP requests
 * 2. Forwards approval requests to Telegram
 * 3. Holds HTTP connections open until user responds
 * 4. Returns decisions back to Claude Code
 */
export async function startServer() {
  const config = loadConfig();
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Initialize queue
  const queue = new ApprovalQueue({
    timeoutSeconds: config.approval.timeoutSeconds,
    fallbackAction: config.approval.fallbackAction,
  });

  // Initialize Telegram bot
  const telegram = new TelegramBridge({
    botToken: config.telegram.botToken,
    chatId: config.telegram.chatId,
    queue,
  });

  // --- Hook Endpoints ---

  /**
   * PreToolUse hook — main approval endpoint.
   * Claude Code POSTs here before executing a tool.
   * We hold the connection open until the user approves/denies via Telegram.
   */
  app.post('/hooks/pre-tool-use', async (req, res) => {
    const { tool_name, tool_input, session_id, cwd } = req.body;

    console.log(`🔧 [${session_id?.slice(0, 8)}] PreToolUse: ${tool_name}`);

    // Track all sessions so /run can identify its own
    telegram.trackSession(session_id);

    // Check if bridge is paused
    if (queue.paused) {
      console.log('  ⏸ Bridge paused — falling back to terminal');
      return res.json({}); // Empty = proceed with normal terminal approval
    }

    // Check if tool is in auto-approve list
    if (config.approval.autoApproveTools.includes(tool_name)) {
      console.log(`  ✅ Auto-approved (safe tool: ${tool_name})`);
      return res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Auto-approved (safe tool)',
        },
      });
    }

    // Check if tool input matches always-deny patterns
    const inputStr = JSON.stringify(tool_input);
    for (const pattern of config.approval.alwaysDenyPatterns) {
      if (inputStr.includes(pattern)) {
        console.log(`  ❌ Auto-denied (matches pattern: ${pattern})`);
        return res.json({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `Blocked by safety rule: "${pattern}"`,
          },
        });
      }
    }

    // Auto-approve requests from /run sessions (user already approved the task)
    if (telegram.isRunSession(session_id)) {
      console.log(`  ✅ Auto-approved (/run session)`);
      return res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Auto-approved (/run command)',
        },
      });
    }

    // Check if in auto-approve-all mode
    if (queue.isAutoApproving()) {
      console.log('  ✅ Auto-approved (/approveall mode)');
      return res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Auto-approved (approveall mode)',
        },
      });
    }

    // Add to queue and send Telegram notification
    const queuePromise = queue.add({ toolName: tool_name, toolInput: tool_input, sessionId: session_id, cwd });

    // Get the ID of the just-added item (last item in queue)
    const pendingList = queue.list();
    const lastEntry = pendingList[pendingList.length - 1];

    if (lastEntry) {
      try {
        await telegram.sendApprovalRequest({
          id: lastEntry.id,
          toolName: tool_name,
          toolInput: tool_input,
          sessionId: session_id,
          cwd,
        });
      } catch (err) {
        console.error('  ⚠️ Failed to send Telegram message:', err.message);
        // If Telegram fails, fall back to terminal
        return res.json({});
      }
    }

    // Wait for user response (or timeout)
    const result = await queuePromise;

    console.log(`  ${result.decision === 'allow' ? '✅' : '❌'} Decision: ${result.decision} ${result.timedOut ? '(timeout)' : ''}`);

    if (result.decision === 'ask') {
      // Fall back to terminal approval
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

  /**
   * Notification hook — async, just forward to Telegram
   */
  app.post('/hooks/notification', async (req, res) => {
    console.log('🔔 Notification:', req.body.type || 'unknown');
    res.json({}); // Return immediately (async hook)

    try {
      await telegram.sendNotification(req.body);
    } catch (err) {
      console.error('Failed to forward notification:', err.message);
    }
  });

  /**
   * Stop hook — Claude finished, notify user
   */
  app.post('/hooks/stop', async (req, res) => {
    console.log('⏹ Claude stopped');
    res.json({}); // Return immediately (async hook)

    try {
      await telegram.sendStopNotification(req.body);
    } catch (err) {
      console.error('Failed to send stop notification:', err.message);
    }
  });

  /**
   * Health check
   */
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      pending: queue.size,
      autoApproving: queue.isAutoApproving(),
      paused: queue.paused,
      uptime: process.uptime(),
    });
  });

  /**
   * Status API
   */
  app.get('/api/status', (req, res) => {
    res.json({
      pending: queue.list(),
      autoApproving: queue.isAutoApproving(),
      paused: queue.paused,
    });
  });

  // Start Express FIRST so hooks have somewhere to land
  const port = config.server.port;
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`🌉 Bridge server listening on http://127.0.0.1:${port}`);
    console.log(`📱 Waiting for Claude Code hook requests...`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  POST /hooks/pre-tool-use  — PreToolUse hook`);
    console.log(`  POST /hooks/notification  — Notification hook`);
    console.log(`  POST /hooks/stop          — Stop hook`);
    console.log(`  GET  /health              — Health check`);
    console.log('');

    savePid(process.pid);
  });

  // Start Telegram bot AFTER Express is up, with timeout so it doesn't block forever
  try {
    const launchPromise = telegram.start();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Telegram bot launch timed out after 10s')), 10000)
    );
    await Promise.race([launchPromise, timeoutPromise]);
    console.log('🤖 Telegram bot started (long polling)');
    await telegram.sendMessage('🟢 Claude Remote Bridge is running! Use /help for commands.');
  } catch (err) {
    console.error(`⚠️ Telegram bot failed to start: ${err.message}`);
    console.error('   Bridge is running — hooks will fall back to terminal approval.');
  }

  // Prevent system from sleeping while the bridge is running
  let sleepInhibitor = null;
  if (process.platform === 'darwin') {
    sleepInhibitor = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
      stdio: 'ignore',
      detached: true,
    });
    sleepInhibitor.unref();
    console.log('☕ Keeping system awake (caffeinate)');
  } else if (process.platform === 'linux') {
    sleepInhibitor = spawn('systemd-inhibit', [
      '--what=idle',
      '--who=claude-remote-bridge',
      '--why=Bridge server is running',
      'sleep', 'infinity',
    ], { stdio: 'ignore', detached: true });
    sleepInhibitor.unref();
    sleepInhibitor.on('error', () => {
      // systemd-inhibit not available (headless server, etc.) — that's fine
      sleepInhibitor = null;
    });
    console.log('☕ Keeping system awake (systemd-inhibit)');
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down...');
    if (caffeinate) caffeinate.kill();
    telegram.stop();
    server.close();
    process.exit(0);
  };

  // Expose shutdown so Telegram /stop command can trigger it
  telegram.onShutdown = shutdown;

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { app, server, queue, telegram };
}
