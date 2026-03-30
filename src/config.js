import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.claude-remote-bridge');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PID_FILE = join(CONFIG_DIR, 'server.pid');

const DEFAULT_CONFIG = {
  telegram: {
    botToken: '',
    chatId: '',
  },
  server: {
    port: 3456,
  },
  approval: {
    timeoutSeconds: 300,
    fallbackAction: 'ask', // 'ask' = show in terminal, 'allow' = auto-approve, 'deny' = auto-deny
    autoApproveTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite'],
    allowedBashCommands: [
      'ls', 'find', 'grep', 'rg', 'cat', 'head', 'tail', 'wc',
      'cd', 'pwd', 'echo', 'printf',
      'git status', 'git log', 'git diff', 'git grep', 'git show', 'git branch',
      'node --version', 'npm --version', 'npx vitest',
    ],
    deniedBashPatterns: [
      'rm -rf /',
      'git push --force',
      'git push -f',
      'git reset --hard',
      'git clean -f',
      '> /dev/sda',
      'mkfs.',
      'dd if=',
      ':(){:|:&};:',
    ],
  },
};

export function getConfigDir() {
  return CONFIG_DIR;
}

export function getConfigPath() {
  return CONFIG_FILE;
}

export function getPidPath() {
  return PID_FILE;
}

export function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig() {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const saved = JSON.parse(raw);
    // Deep merge with defaults
    return {
      telegram: { ...DEFAULT_CONFIG.telegram, ...saved.telegram },
      server: { ...DEFAULT_CONFIG.server, ...saved.server },
      approval: { ...DEFAULT_CONFIG.approval, ...saved.approval },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function isConfigured() {
  const config = loadConfig();
  return !!(config.telegram.botToken && config.telegram.chatId);
}

export function savePid(pid) {
  ensureConfigDir();
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

export function loadPid() {
  if (!existsSync(PID_FILE)) return null;
  try {
    return parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

export function removePid() {
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }
}
