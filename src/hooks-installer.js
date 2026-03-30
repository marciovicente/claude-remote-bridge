import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

/**
 * Generate the hooks configuration for Claude Code
 */
function generateHooksConfig(port = 3456) {
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    PreToolUse: [
      {
        matcher: 'Bash|Edit|Write|NotebookEdit',
        hooks: [
          {
            type: 'http',
            url: `${baseUrl}/hooks/pre-tool-use`,
            timeout: 300,
            statusMessage: '⏳ Awaiting remote approval via Telegram...',
          },
        ],
      },
    ],
    Notification: [
      {
        hooks: [
          {
            type: 'http',
            url: `${baseUrl}/hooks/notification`,
            async: true,
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'http',
            url: `${baseUrl}/hooks/stop`,
            async: true,
          },
        ],
      },
    ],
  };
}

/**
 * Read current Claude Code settings
 */
function readClaudeSettings() {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Write Claude Code settings
 */
function writeClaudeSettings(settings) {
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Install hooks into Claude Code settings.
 * Merges with existing hooks (doesn't overwrite other hooks).
 */
export function installHooks(port = 3456) {
  const settings = readClaudeSettings();
  const newHooks = generateHooksConfig(port);

  // Initialize hooks object if needed
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // For each hook type, check if our bridge hook already exists
  for (const [eventName, hookConfigs] of Object.entries(newHooks)) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = [];
    }

    // Remove any existing claude-remote-bridge hooks (by URL pattern)
    settings.hooks[eventName] = settings.hooks[eventName].filter((config) => {
      if (!config.hooks) return true;
      return !config.hooks.some(
        (h) => h.type === 'http' && h.url && h.url.includes('/hooks/')
          && h.url.includes(`127.0.0.1`)
      );
    });

    // Add our hooks
    settings.hooks[eventName].push(...hookConfigs);
  }

  writeClaudeSettings(settings);
  return CLAUDE_SETTINGS_PATH;
}

/**
 * Remove our hooks from Claude Code settings
 */
export function uninstallHooks() {
  const settings = readClaudeSettings();
  if (!settings.hooks) return;

  for (const eventName of Object.keys(settings.hooks)) {
    settings.hooks[eventName] = settings.hooks[eventName].filter((config) => {
      if (!config.hooks) return true;
      return !config.hooks.some(
        (h) => h.type === 'http' && h.url && h.url.includes('/hooks/')
          && h.url.includes(`127.0.0.1`)
      );
    });

    // Clean up empty arrays
    if (settings.hooks[eventName].length === 0) {
      delete settings.hooks[eventName];
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeClaudeSettings(settings);
  return CLAUDE_SETTINGS_PATH;
}

/**
 * Check if hooks are currently installed
 */
export function isHooksInstalled(port = 3456) {
  const settings = readClaudeSettings();
  if (!settings.hooks?.PreToolUse) return false;

  return settings.hooks.PreToolUse.some((config) =>
    config.hooks?.some(
      (h) => h.type === 'http' && h.url?.includes(`127.0.0.1:${port}`)
    )
  );
}

export { CLAUDE_SETTINGS_PATH };
