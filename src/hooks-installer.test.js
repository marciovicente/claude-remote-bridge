import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => {
  const store = new Map();
  return {
    existsSync: vi.fn((path) => store.has(path)),
    readFileSync: vi.fn((path) => {
      if (!store.has(path)) throw new Error('ENOENT');
      return store.get(path);
    }),
    writeFileSync: vi.fn((path, content) => { store.set(path, content); }),
    _store: store,
  };
});

vi.mock('os', () => ({
  homedir: () => '/fakehome',
}));

const fs = await import('fs');
const { installHooks, uninstallHooks, isHooksInstalled, CLAUDE_SETTINGS_PATH } = await import('./hooks-installer.js');

describe('hooks-installer', () => {
  beforeEach(() => {
    fs._store.clear();
    vi.clearAllMocks();
  });

  describe('installHooks', () => {
    it('creates hooks in empty settings', () => {
      const result = installHooks(3456);
      expect(result).toBe(CLAUDE_SETTINGS_PATH);

      const settings = JSON.parse(fs._store.get(CLAUDE_SETTINGS_PATH));
      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0].matcher).toBe('Bash|Edit|Write|NotebookEdit');
      expect(settings.hooks.PreToolUse[0].hooks[0].url).toContain('127.0.0.1:3456');
      expect(settings.hooks.Notification).toHaveLength(1);
      expect(settings.hooks.Stop).toHaveLength(1);
    });

    it('preserves existing non-bridge hooks', () => {
      fs._store.set(CLAUDE_SETTINGS_PATH, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'SomeTool', hooks: [{ type: 'command', command: 'echo hi' }] },
          ],
        },
      }));

      installHooks(3456);
      const settings = JSON.parse(fs._store.get(CLAUDE_SETTINGS_PATH));
      // Should have the existing hook + our new one
      expect(settings.hooks.PreToolUse).toHaveLength(2);
      expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('echo hi');
    });

    it('replaces existing bridge hooks on reinstall', () => {
      installHooks(3456);
      installHooks(4000); // reinstall with different port

      const settings = JSON.parse(fs._store.get(CLAUDE_SETTINGS_PATH));
      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0].hooks[0].url).toContain('127.0.0.1:4000');
    });

    it('uses custom port', () => {
      installHooks(9999);
      const settings = JSON.parse(fs._store.get(CLAUDE_SETTINGS_PATH));
      expect(settings.hooks.PreToolUse[0].hooks[0].url).toContain(':9999');
      expect(settings.hooks.Notification[0].hooks[0].url).toContain(':9999');
      expect(settings.hooks.Stop[0].hooks[0].url).toContain(':9999');
    });
  });

  describe('uninstallHooks', () => {
    it('removes bridge hooks', () => {
      installHooks(3456);
      uninstallHooks();

      const settings = JSON.parse(fs._store.get(CLAUDE_SETTINGS_PATH));
      // hooks object should be cleaned up entirely
      expect(settings.hooks).toBeUndefined();
    });

    it('preserves non-bridge hooks when uninstalling', () => {
      fs._store.set(CLAUDE_SETTINGS_PATH, JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Other', hooks: [{ type: 'command', command: 'test' }] },
            { matcher: 'Bash', hooks: [{ type: 'http', url: 'http://127.0.0.1:3456/hooks/pre-tool-use' }] },
          ],
        },
      }));

      uninstallHooks();
      const settings = JSON.parse(fs._store.get(CLAUDE_SETTINGS_PATH));
      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0].matcher).toBe('Other');
    });

    it('handles no existing settings gracefully', () => {
      expect(() => uninstallHooks()).not.toThrow();
    });
  });

  describe('isHooksInstalled', () => {
    it('returns false when no settings exist', () => {
      expect(isHooksInstalled(3456)).toBe(false);
    });

    it('returns true after install', () => {
      installHooks(3456);
      expect(isHooksInstalled(3456)).toBe(true);
    });

    it('returns false for wrong port', () => {
      installHooks(3456);
      expect(isHooksInstalled(9999)).toBe(false);
    });

    it('returns false after uninstall', () => {
      installHooks(3456);
      uninstallHooks();
      expect(isHooksInstalled(3456)).toBe(false);
    });
  });
});
