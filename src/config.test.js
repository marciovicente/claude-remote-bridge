import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

// Mock fs before importing config
vi.mock('fs', () => {
  const store = new Map();
  return {
    existsSync: vi.fn((path) => store.has(path)),
    readFileSync: vi.fn((path) => {
      if (!store.has(path)) throw new Error('ENOENT');
      return store.get(path);
    }),
    writeFileSync: vi.fn((path, content) => { store.set(path, content); }),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn((path) => { store.delete(path); }),
    _store: store,
  };
});

// Mock os.homedir to a predictable path
vi.mock('os', () => ({
  homedir: () => '/fakehome',
}));

const fs = await import('fs');
const { loadConfig, saveConfig, isConfigured, savePid, loadPid, removePid, getConfigDir, getConfigPath, getPidPath } = await import('./config.js');

describe('config', () => {
  beforeEach(() => {
    fs._store.clear();
    vi.clearAllMocks();
  });

  describe('paths', () => {
    it('returns correct config dir', () => {
      expect(getConfigDir()).toBe(join('/fakehome', '.claude-remote-bridge'));
    });

    it('returns correct config path', () => {
      expect(getConfigPath()).toContain('config.json');
    });

    it('returns correct pid path', () => {
      expect(getPidPath()).toContain('server.pid');
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', () => {
      const config = loadConfig();
      expect(config.telegram.botToken).toBe('');
      expect(config.telegram.chatId).toBe('');
      expect(config.server.port).toBe(3456);
      expect(config.approval.timeoutSeconds).toBe(300);
      expect(config.approval.autoApproveTools).toContain('Read');
    });

    it('merges saved config with defaults', () => {
      const configPath = getConfigPath();
      fs._store.set(configPath, JSON.stringify({
        telegram: { botToken: 'mytoken' },
        server: { port: 9999 },
      }));

      const config = loadConfig();
      expect(config.telegram.botToken).toBe('mytoken');
      expect(config.telegram.chatId).toBe(''); // default
      expect(config.server.port).toBe(9999);
      expect(config.approval.timeoutSeconds).toBe(300); // default
    });

    it('returns defaults on invalid JSON', () => {
      fs._store.set(getConfigPath(), 'not json {{{');
      const config = loadConfig();
      expect(config.server.port).toBe(3456);
    });
  });

  describe('saveConfig', () => {
    it('persists config to file', () => {
      const config = { telegram: { botToken: 'tok', chatId: '123' }, server: { port: 4000 }, approval: {} };
      saveConfig(config);

      const saved = JSON.parse(fs._store.get(getConfigPath()));
      expect(saved.telegram.botToken).toBe('tok');
      expect(saved.server.port).toBe(4000);
    });
  });

  describe('isConfigured', () => {
    it('returns false when no token/chatId', () => {
      expect(isConfigured()).toBe(false);
    });

    it('returns true when both token and chatId are set', () => {
      fs._store.set(getConfigPath(), JSON.stringify({
        telegram: { botToken: 'tok', chatId: '123' },
      }));
      expect(isConfigured()).toBe(true);
    });

    it('returns false when only token is set', () => {
      fs._store.set(getConfigPath(), JSON.stringify({
        telegram: { botToken: 'tok', chatId: '' },
      }));
      expect(isConfigured()).toBe(false);
    });
  });

  describe('PID management', () => {
    it('saves and loads a PID', () => {
      savePid(12345);
      expect(loadPid()).toBe(12345);
    });

    it('returns null when no PID file', () => {
      expect(loadPid()).toBeNull();
    });

    it('removes PID file', () => {
      savePid(99);
      removePid();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });
});
