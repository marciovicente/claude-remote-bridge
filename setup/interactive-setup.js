import { createInterface } from 'readline';
import { loadConfig, saveConfig, getConfigPath } from '../src/config.js';
import { installHooks, CLAUDE_SETTINGS_PATH } from '../src/hooks-installer.js';

function createPrompt() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function runSetup() {
  const rl = createPrompt();
  const config = loadConfig();

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   🤖 Claude Remote Bridge — Setup Wizard     ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║ This will configure:                         ║');
  console.log('║  1. Telegram Bot (for notifications)         ║');
  console.log('║  2. Claude Code Hooks (for interception)     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // --- Step 1: Telegram Bot ---
  console.log('━━━ Step 1: Create a Telegram Bot ━━━');
  console.log('');
  console.log('  1. Open Telegram and search for @BotFather');
  console.log('  2. Send /newbot');
  console.log('  3. Choose a name (e.g., "Claude Remote")');
  console.log('  4. Choose a username (e.g., "my_claude_remote_bot")');
  console.log('  5. Copy the API token BotFather gives you');
  console.log('');

  const botToken = await ask(rl, '  Paste your bot token here: ');
  if (!botToken || !botToken.includes(':')) {
    console.log('  ❌ Invalid token format. Expected format: 123456:ABC-DEF...');
    rl.close();
    process.exit(1);
  }

  config.telegram.botToken = botToken;
  console.log('  ✅ Bot token saved');
  console.log('');

  // --- Step 2: Get Chat ID ---
  console.log('━━━ Step 2: Link your Telegram account ━━━');
  console.log('');
  console.log('  1. In Telegram, search for the bot username you just created');
  console.log('     (the @username you chose in Step 1, NOT @BotFather)');
  console.log('  2. Open the conversation with YOUR bot and send "hello"');
  console.log('');
  await ask(rl, '  Press Enter after sending a message to your bot...');
  console.log('');
  console.log('  🔍 Looking for your message...');

  // Fetch updates to get chat ID
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates?limit=5&offset=-5`
    );
    const data = await response.json();

    if (!data.ok || !data.result?.length) {
      console.log('  ⚠️ No messages found. Make sure you sent a message to the bot.');
      const manualId = await ask(rl, '  Enter your Chat ID manually (or press Enter to retry): ');
      if (manualId) {
        config.telegram.chatId = manualId;
      } else {
        rl.close();
        process.exit(1);
      }
    } else {
      // Get the most recent message's chat ID
      const lastMessage = data.result[data.result.length - 1];
      const chatId = lastMessage.message?.chat?.id || lastMessage.my_chat_member?.chat?.id;
      const chatName =
        lastMessage.message?.chat?.first_name || lastMessage.my_chat_member?.chat?.first_name || 'User';

      if (!chatId) {
        console.log('  ⚠️ Could not extract chat ID from messages.');
        const manualId = await ask(rl, '  Enter your Chat ID manually: ');
        config.telegram.chatId = manualId;
      } else {
        config.telegram.chatId = String(chatId);
        console.log(`  ✅ Found! Chat ID: ${chatId} (${chatName})`);
      }
    }
  } catch (err) {
    console.log(`  ⚠️ Error fetching updates: ${err.message}`);
    const manualId = await ask(rl, '  Enter your Chat ID manually: ');
    config.telegram.chatId = manualId;
  }

  console.log('');

  // --- Step 3: Server port ---
  console.log('━━━ Step 3: Server Configuration ━━━');
  const portStr = await ask(rl, `  Server port [${config.server.port}]: `);
  if (portStr) {
    config.server.port = parseInt(portStr, 10);
  }
  console.log(`  ✅ Port: ${config.server.port}`);
  console.log('');

  // --- Step 4: Save config ---
  saveConfig(config);
  console.log(`  💾 Config saved to: ${getConfigPath()}`);
  console.log('');

  // --- Step 5: Install Claude Code hooks ---
  console.log('━━━ Step 4: Install Claude Code Hooks ━━━');
  const installAnswer = await ask(rl, '  Install hooks into Claude Code settings? [Y/n]: ');

  if (installAnswer.toLowerCase() !== 'n') {
    try {
      const settingsPath = installHooks(config.server.port);
      console.log(`  ✅ Hooks installed in: ${settingsPath}`);
      console.log('');
      console.log('  Hooks configured:');
      console.log('    • PreToolUse  → Bash, Edit, Write, NotebookEdit (blocking)');
      console.log('    • Notification → All notifications (async)');
      console.log('    • Stop         → Session stop events (async)');
    } catch (err) {
      console.log(`  ⚠️ Could not install hooks: ${err.message}`);
      console.log(`  You can manually add hooks to: ${CLAUDE_SETTINGS_PATH}`);
    }
  }

  console.log('');

  // --- Step 6: Test connection ---
  console.log('━━━ Step 5: Test Connection ━━━');
  console.log('  Sending test message to Telegram...');

  try {
    const testResponse = await fetch(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: '🎉 Claude Remote Bridge setup complete!\n\nYou will receive approval requests here when Claude Code needs permission to use tools.\n\nUse /help to see available commands.',
        }),
      }
    );
    const testData = await testResponse.json();

    if (testData.ok) {
      console.log('  ✅ Test message sent! Check your Telegram.');
    } else {
      console.log(`  ⚠️ Test failed: ${testData.description}`);
    }
  } catch (err) {
    console.log(`  ⚠️ Test failed: ${err.message}`);
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   ✅ Setup complete!                         ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║                                              ║');
  console.log('║  Start the bridge:                           ║');
  console.log('║    claude-remote-bridge start                ║');
  console.log('║                                              ║');
  console.log('║  Then use Claude Code normally.              ║');
  console.log('║  Approval requests will come to Telegram!    ║');
  console.log('║                                              ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  rl.close();
}
