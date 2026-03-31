import { Telegraf, Markup } from 'telegraf';
import { spawn } from 'child_process';
import {
  formatToolRequest,
  formatToolDetails,
  formatCompactSummary,
  formatNotification,
  formatStop,
  formatStatus,
} from './formatters.js';

/**
 * Telegram bot that sends approval requests and handles user responses.
 * Uses long polling (outbound only — no tunnel needed).
 */
export class TelegramBridge {
  constructor({ botToken, chatId, queue }) {
    this.botToken = botToken;
    this.chatId = String(chatId);
    this.queue = queue;
    this.bot = null;
    this.started = false;
    this.runningProcess = null;
    this.runSessionId = null;
    this.knownSessions = new Set();
    this.onShutdown = null;
    this.pendingComment = null;
    // Map approval ID -> { toolName, toolInput, cwd } for post-decision summary
    this.approvalMeta = new Map();
  }

  async start() {
    this.bot = new Telegraf(this.botToken);

    // --- Command handlers ---

    this.bot.command('status', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      const msg = formatStatus(
        this.queue.list(),
        this.queue.isAutoApproving(),
        this.queue.approveAllUntil,
        this.queue.paused
      );
      await ctx.reply(msg, { parse_mode: 'HTML' });
    });

    this.bot.command('approveall', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      const args = ctx.message.text.split(' ');
      const minutes = parseInt(args[1], 10) || 30;
      this.queue.setApproveAll(minutes);
      const approved = this.queue.approveAllPending();
      await ctx.reply(
        `✅ Auto-approve enabled for ${minutes} minutes.\n` +
        (approved > 0 ? `Approved ${approved} pending request(s).` : 'No pending requests.')
      );
    });

    this.bot.command('stopapprove', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      this.queue.clearApproveAll();
      await ctx.reply('🛑 Auto-approve disabled.');
    });

    this.bot.command('pause', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      this.queue.paused = !this.queue.paused;
      if (this.queue.paused) {
        await ctx.reply('⏸ Bridge paused. Requests fall back to terminal.');
      } else {
        await ctx.reply('▶️ Bridge resumed.');
      }
    });

    this.bot.command('run', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      const instruction = ctx.message.text.replace(/^\/run\s*/, '').trim();
      if (!instruction) {
        await ctx.reply('Usage: /run <instruction>\nExample: /run add input validation to the login form');
        return;
      }

      if (this.runningProcess) {
        await ctx.reply('⚠️ A command is already running. Use /cancel to stop it first.');
        return;
      }

      await ctx.reply(`🚀 Running: ${instruction.slice(0, 200)}${instruction.length > 200 ? '...' : ''}`);
      console.log(`🚀 [Telegram] /run: ${instruction.slice(0, 100)}`);

      this._executeClaudeCommand(instruction)
        .then(async (result) => {
          const chunks = this._splitMessage(result, 4000);
          for (const chunk of chunks) {
            await this.bot.telegram.sendMessage(this.chatId, chunk);
          }
          await this.bot.telegram.sendMessage(this.chatId, '✅ /run finished.');
        })
        .catch(async (err) => {
          await this.bot.telegram.sendMessage(this.chatId, `❌ /run error: ${err.message}`);
        });
    });

    this.bot.command('cancel', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      if (!this.runningProcess) {
        await ctx.reply('No command is currently running.');
        return;
      }
      this.runningProcess.kill('SIGTERM');
      this.runningProcess = null;
      this.runSessionId = null;
      await ctx.reply('🛑 Command cancelled.');
    });

    this.bot.command('stop', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      await ctx.reply('🛑 Shutting down bridge...');
      setTimeout(() => {
        if (this.onShutdown) this.onShutdown();
      }, 500);
    });

    this.bot.command('help', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      const help = [
        '<b>Commands</b>',
        '',
        '/run &lt;instruction&gt; — Send instruction to Claude',
        '/cancel — Cancel running command',
        '/status — Show pending approvals',
        '/approveall [min] — Auto-approve for N minutes',
        '/stopapprove — Stop auto-approving',
        '/pause — Toggle pause (fall back to terminal)',
        '/stop — Shut down the bridge',
      ];
      await ctx.reply(help.join('\n'), { parse_mode: 'HTML' });
    });

    // --- Callback query handlers (inline buttons) ---

    this.bot.action(/^approve:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const meta = this.approvalMeta.get(id);
      const success = this.queue.respond(id, 'allow');
      if (success) {
        // Collapse message to compact one-liner + remove buttons
        const summary = meta
          ? formatCompactSummary(meta)
          : 'Approved';
        try {
          await ctx.editMessageText(`✅ ${summary}`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] },
          });
        } catch {
          // Fallback if edit fails
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        }
        this.approvalMeta.delete(id);
        await ctx.answerCbQuery('Approved');
      } else {
        await ctx.answerCbQuery('⚠️ Request expired or already handled');
      }
    });

    this.bot.action(/^deny:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const meta = this.approvalMeta.get(id);
      const success = this.queue.respond(id, 'deny');
      if (success) {
        const summary = meta
          ? formatCompactSummary(meta)
          : 'Denied';
        try {
          await ctx.editMessageText(`❌ ${summary}`, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] },
          });
        } catch {
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        }
        this.approvalMeta.delete(id);
        await ctx.answerCbQuery('Denied');
      } else {
        await ctx.answerCbQuery('⚠️ Request expired or already handled');
      }
    });

    this.bot.action(/^details:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const entry = this.queue.get(id);
      if (entry) {
        const details = formatToolDetails(entry);
        try {
          await ctx.reply(details, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(JSON.stringify(entry.toolInput, null, 2).slice(0, 4000));
        }
        await ctx.answerCbQuery();
      } else {
        await ctx.answerCbQuery('⚠️ Request not found');
      }
    });

    this.bot.action(/^comment:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const entry = this.queue.get(id);
      if (entry) {
        this.pendingComment = { id, messageId: ctx.callbackQuery.message.message_id };
        await ctx.reply('💬 Type your instructions below. This will reject the action and tell Claude what to do.');
        await ctx.answerCbQuery('Type your instructions below');
      } else {
        await ctx.answerCbQuery('⚠️ Request expired or already handled');
      }
    });

    // Capture text messages as comments when waiting for instructions
    this.bot.on('text', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      if (!this.pendingComment) return;
      if (ctx.message.text.startsWith('/')) return;

      const { id, messageId } = this.pendingComment;
      this.pendingComment = null;

      const instruction = ctx.message.text.trim();
      const meta = this.approvalMeta.get(id);
      const success = this.queue.respond(id, 'deny', `User instruction: ${instruction}`);
      if (success) {
        try {
          const summary = meta
            ? formatCompactSummary(meta)
            : '';
          await this.bot.telegram.editMessageText(
            this.chatId,
            messageId,
            null,
            `💬 ${summary}\n${instruction.slice(0, 200)}`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
          );
        } catch {
          // Original message may not be editable anymore
        }
        this.approvalMeta.delete(id);
        await ctx.reply(`💬 Sent to Claude: "${instruction.slice(0, 200)}"`);
      } else {
        await ctx.reply('⚠️ That request already expired or was handled.');
      }
    });

    // Start long polling
    await this.bot.launch({ dropPendingUpdates: true });
    this.started = true;

    // Graceful stop
    process.once('SIGINT', () => this.stop());
    process.once('SIGTERM', () => this.stop());
  }

  /**
   * Send an approval request to the user
   */
  async sendApprovalRequest({ id, toolName, toolInput, sessionId, cwd }) {
    // Store meta for compact summary after decision
    this.approvalMeta.set(id, { toolName, toolInput, cwd });

    const message = formatToolRequest({ id, toolName, toolInput, sessionId, cwd });
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅', `approve:${id}`),
      Markup.button.callback('❌', `deny:${id}`),
      Markup.button.callback('💬', `comment:${id}`),
      Markup.button.callback('👁', `details:${id}`),
    ]);

    try {
      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
        ...keyboard,
      });
    } catch (err) {
      // Fallback: try without HTML if formatting fails
      console.error('HTML send failed, retrying plain:', err.message);
      const plainMessage = `${toolName}: ${JSON.stringify(toolInput).slice(0, 200)}`;
      await this.bot.telegram.sendMessage(this.chatId, plainMessage, keyboard);
    }
  }

  /**
   * Send a notification (non-blocking)
   */
  async sendNotification(data) {
    try {
      const message = formatNotification(data);
      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
      });
    } catch (err) {
      console.error('Failed to send notification:', err.message);
    }
  }

  /**
   * Send a stop notification
   */
  async sendStopNotification(data) {
    try {
      const message = formatStop(data);
      await this.bot.telegram.sendMessage(this.chatId, message);
    } catch (err) {
      console.error('Failed to send stop notification:', err.message);
    }
  }

  /**
   * Send a simple text message
   */
  async sendMessage(text) {
    if (!this.bot) return;
    await this.bot.telegram.sendMessage(this.chatId, text);
  }

  /**
   * Track a session_id as known (called on every hook request).
   */
  trackSession(sessionId) {
    if (sessionId) this.knownSessions.add(sessionId);
  }

  /**
   * Check if a request belongs to the active /run command.
   */
  isRunSession(sessionId) {
    if (!this.runningProcess || !sessionId) return false;
    if (this.runSessionId) return this.runSessionId === sessionId;
    if (!this.knownSessions.has(sessionId)) {
      this.runSessionId = sessionId;
      console.log(`  🔗 Captured /run session: ${sessionId.slice(0, 8)}`);
      return true;
    }
    return false;
  }

  _executeClaudeCommand(instruction) {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', ['-p', '--output-format', 'text', instruction], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 600000,
      });

      this.runningProcess = proc;
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code, signal) => {
        this.runningProcess = null;
        this.runSessionId = null;
        if (code === 0) {
          resolve(stdout.trim() || '(no output)');
        } else if (code === null || signal) {
          const sig = signal || 'unknown signal';
          reject(new Error(`Process killed by ${sig}`));
        } else {
          // Decode well-known signal exit codes (128 + signal number)
          const signals = { 134: 'SIGABRT (crash/OOM)', 137: 'SIGKILL (OOM killer)', 139: 'SIGSEGV', 143: 'SIGTERM' };
          const hint = signals[code] ? ` — ${signals[code]}` : '';
          reject(new Error(stderr.trim() || `Process exited with code ${code}${hint}`));
        }
      });

      proc.on('error', (err) => {
        this.runningProcess = null;
        this.runSessionId = null;
        if (err.code === 'ENOENT') {
          reject(new Error('Claude CLI not found. Make sure "claude" is installed and in PATH.'));
        } else {
          reject(err);
        }
      });
    });
  }

  _splitMessage(text, maxLen = 4000) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt < maxLen * 0.5) splitAt = maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }
    return chunks;
  }

  stop() {
    if (this.runningProcess) {
      this.runningProcess.kill('SIGTERM');
      this.runningProcess = null;
      this.runSessionId = null;
    }
    if (this.bot && this.started) {
      this.bot.stop();
      this.started = false;
    }
  }
}
