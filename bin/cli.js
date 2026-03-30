#!/usr/bin/env node

import { program } from 'commander';
import { loadConfig, isConfigured, loadPid, getConfigPath } from '../src/config.js';
import { installHooks, uninstallHooks, isHooksInstalled } from '../src/hooks-installer.js';
import { startServer } from '../src/server.js';
import { runSetup } from '../setup/interactive-setup.js';
import { existsSync } from 'fs';

program
  .name('claude-remote-bridge')
  .description('Control Claude Code sessions remotely via Telegram')
  .version('1.0.0');

// --- setup ---
program
  .command('setup')
  .description('Interactive setup wizard — configure Telegram bot and Claude Code hooks')
  .action(async () => {
    await runSetup();
  });

// --- start ---
program
  .command('start')
  .description('Start the bridge server and Telegram bot')
  .option('-d, --detach', 'Run in background (detached mode)')
  .action(async (opts) => {
    if (!isConfigured()) {
      console.log('❌ Not configured yet. Run: claude-remote-bridge setup');
      process.exit(1);
    }

    const config = loadConfig();

    if (opts.detach) {
      // Fork a detached child process
      const { fork } = await import('child_process');
      const child = fork(new URL(import.meta.url).pathname, ['start'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      console.log(`🚀 Bridge started in background (PID: ${child.pid})`);
      console.log(`   Port: ${config.server.port}`);
      console.log(`   Stop with: claude-remote-bridge stop`);
      process.exit(0);
    }

    console.log('');
    console.log('🌉 Starting Claude Remote Bridge...');
    console.log('');

    try {
      await startServer();
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${config.server.port} is already in use.`);
        console.error('   Is the bridge already running? Try: claude-remote-bridge stop');
      } else {
        console.error('❌ Failed to start:', err.message);
      }
      process.exit(1);
    }
  });

// --- stop ---
program
  .command('stop')
  .description('Stop the background bridge server')
  .action(async () => {
    const pid = loadPid();
    if (!pid) {
      console.log('⚠️ No running bridge found (no PID file).');

      // Try to find by port
      const config = loadConfig();
      try {
        const res = await fetch(`http://127.0.0.1:${config.server.port}/health`);
        if (res.ok) {
          console.log(`   But server is responding on port ${config.server.port}.`);
          console.log('   It may have been started manually. Stop it with Ctrl+C.');
        }
      } catch {
        console.log('   No server running on configured port either.');
      }
      return;
    }

    try {
      process.kill(pid, 'SIGTERM');
      console.log(`🛑 Stopped bridge (PID: ${pid})`);
    } catch (err) {
      if (err.code === 'ESRCH') {
        console.log(`⚠️ Process ${pid} not found (already stopped?)`);
      } else {
        console.error(`❌ Error stopping process: ${err.message}`);
      }
    }

    // Clean up PID file
    try {
      const { unlinkSync } = await import('fs');
      const { getPidPath } = await import('../src/config.js');
      unlinkSync(getPidPath());
    } catch { /* ignore */ }
  });

// --- status ---
program
  .command('status')
  .description('Check if the bridge is running')
  .action(async () => {
    const config = loadConfig();
    const pid = loadPid();

    console.log('');
    console.log('📊 Claude Remote Bridge Status');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Config status
    console.log(`  Config: ${existsSync(getConfigPath()) ? '✅ Found' : '❌ Not found'}`);
    console.log(`  Telegram: ${config.telegram.botToken ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`  Hooks: ${isHooksInstalled(config.server.port) ? '✅ Installed' : '❌ Not installed'}`);

    // Server status
    if (pid) {
      try {
        process.kill(pid, 0); // Check if process exists
        console.log(`  Server: 🟢 Running (PID: ${pid})`);
      } catch {
        console.log(`  Server: 🔴 Stopped (stale PID: ${pid})`);
      }
    } else {
      console.log('  Server: 🔴 Not running');
    }

    // Try to reach health endpoint
    try {
      const res = await fetch(`http://127.0.0.1:${config.server.port}/health`);
      const data = await res.json();
      console.log(`  Port: ${config.server.port} (responding)`);
      console.log(`  Pending: ${data.pending} approval(s)`);
      console.log(`  Auto-approve: ${data.autoApproving ? '🟢 Active' : '⚪ Off'}`);
      console.log(`  Paused: ${data.paused ? '⏸ Yes' : '▶️ No'}`);
      console.log(`  Uptime: ${Math.round(data.uptime)}s`);
    } catch {
      console.log(`  Port: ${config.server.port} (not responding)`);
    }

    console.log('');
  });

// --- test ---
program
  .command('test')
  .description('Send a test message to Telegram')
  .action(async () => {
    if (!isConfigured()) {
      console.log('❌ Not configured. Run: claude-remote-bridge setup');
      process.exit(1);
    }

    const config = loadConfig();
    console.log('📨 Sending test message...');

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: config.telegram.chatId,
            text: '🧪 Test message from Claude Remote Bridge!\nIf you see this, the connection is working.',
          }),
        }
      );
      const data = await res.json();
      if (data.ok) {
        console.log('✅ Message sent! Check your Telegram.');
      } else {
        console.log(`❌ Failed: ${data.description}`);
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
  });

// --- hooks install/uninstall ---
program
  .command('hooks-install')
  .description('Install Claude Code hooks (without full setup)')
  .action(() => {
    const config = loadConfig();
    const path = installHooks(config.server.port);
    console.log(`✅ Hooks installed in: ${path}`);
  });

program
  .command('hooks-uninstall')
  .description('Remove Claude Code hooks')
  .action(() => {
    uninstallHooks();
    console.log('✅ Hooks removed from Claude Code settings.');
  });

program.parse();
