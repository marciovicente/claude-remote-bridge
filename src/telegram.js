import { Telegraf, Markup } from 'telegraf';
import { spawn } from 'child_process';
import {
  formatToolRequest,
  formatToolDetails,
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
  }

  async start() {
    this.bot = new Telegraf(this.botToken);

    // --- Command handlers ---

    this.bot.command('status', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      const msg = formatStatus(
        this.queue.list(),
        this.queue.isAutoApproving(),
        this.queue.approveAllUntil
      );
      await ctx.replyWithMarkdownV2(msg);
    });

    this.bot.command('approveall', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      const args = ctx.message.text.split(' ');
      const minutes = parseInt(args[1], 10) || 30;
      this.queue.setApproveAll(minutes);
      // Also approve anything currently pending
      const approved = this.queue.approveAllPending();
      await ctx.reply(
        `✅ Auto-approve enabled for ${minutes} minutes.\n` +
        (approved > 0 ? `Approved ${approved} pending request(s).` : 'No pending requests.')
      );
    });

    this.bot.command('stopapprove', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      this.queue.clearApproveAll();
      await ctx.reply('🛑 Auto-approve disabled. Requests will need manual approval.');
    });

    this.bot.command('pause', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      this.queue.paused = !this.queue.paused;
      if (this.queue.paused) {
        await ctx.reply('⏸ Bridge paused. Requests will fall back to terminal approval.');
      } else {
        await ctx.reply('▶️ Bridge resumed. Requests will come to Telegram.');
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

      // Run in background so the bot stays responsive to approve/deny buttons
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
      // Give Telegram time to send the reply before we exit
      setTimeout(() => {
        if (this.onShutdown) this.onShutdown();
      }, 500);
    });

    this.bot.command('help', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      await ctx.reply(
        '🤖 Claude Remote Bridge Commands:\n\n' +
        '/run <instruction> — Send an instruction to Claude Code\n' +
        '/cancel — Cancel a running /run command\n' +
        '/status — Show pending approvals\n' +
        '/approveall [min] — Auto-approve for N minutes (default 30)\n' +
        '/stopapprove — Stop auto-approving\n' +
        '/pause — Toggle pause (fall back to terminal)\n' +
        '/stop — Shut down the bridge remotely\n' +
        '/help — Show this message'
      );
    });

    // --- Callback query handlers (inline buttons) ---

    this.bot.action(/^approve:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const success = this.queue.respond(id, 'allow');
      if (success) {
        const original = ctx.callbackQuery.message.text || '';
        await ctx.editMessageText(`✅ ${original}`);
        await ctx.answerCbQuery('Approved');
      } else {
        await ctx.answerCbQuery('⚠️ Request expired or already handled');
      }
    });

    this.bot.action(/^deny:(.+)$/, async (ctx) => {
      const id = ctx.match[1];
      const success = this.queue.respond(id, 'deny');
      if (success) {
        const original = ctx.callbackQuery.message.text || '';
        await ctx.editMessageText(`❌ ${original}`);
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
          await ctx.replyWithMarkdownV2(details);
        } catch {
          // Fallback to plain text if markdown fails
          await ctx.reply(JSON.stringify(entry.toolInput, null, 2).slice(0, 4000));
        }
        await ctx.answerCbQuery();
      } else {
        await ctx.answerCbQuery('⚠️ Request not found');
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
    const message = formatToolRequest({ id, toolName, toolInput, sessionId, cwd });
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅', `approve:${id}`),
      Markup.button.callback('❌', `deny:${id}`),
      Markup.button.callback('👁', `details:${id}`),
    ]);

    try {
      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'MarkdownV2',
        ...keyboard,
      });
    } catch (err) {
      // Fallback: try without markdown if formatting fails
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
        parse_mode: 'MarkdownV2',
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
      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'MarkdownV2',
      });
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
   * Execute a claude command and return the output
   */
  /**
   * Track a session_id as known (called on every hook request).
   */
  trackSession(sessionId) {
    if (sessionId) this.knownSessions.add(sessionId);
  }

  /**
   * Check if a request belongs to the active /run command.
   * After /run spawns claude, the first request with an unknown session_id
   * is identified as the /run session (all other sessions are already tracked).
   */
  isRunSession(sessionId) {
    if (!this.runningProcess || !sessionId) return false;
    // Already identified
    if (this.runSessionId) return this.runSessionId === sessionId;
    // First unknown session after /run started = the /run session
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
        timeout: 600000, // 10 min max
      });

      this.runningProcess = proc;
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        this.runningProcess = null;
        this.runSessionId = null;
        if (code === 0) {
          resolve(stdout.trim() || '(no output)');
        } else if (code === null) {
          reject(new Error('Command was cancelled'));
        } else {
          reject(new Error(stderr.trim() || `Process exited with code ${code}`));
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

  /**
   * Split a long message into chunks for Telegram's 4096 char limit
   */
  _splitMessage(text, maxLen = 4000) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to split at a newline
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
