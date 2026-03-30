import { describe, it, expect } from 'vitest';
import {
  formatToolRequest,
  formatToolDetails,
  formatNotification,
  formatStop,
  formatStatus,
} from './formatters.js';

describe('formatToolRequest', () => {
  it('formats a Bash command', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'Bash',
      toolInput: { command: 'npm install' },
      sessionId: 'sess1',
      cwd: '/home/user/project',
    });
    expect(result).toContain('💻');
    expect(result).toContain('*Bash*');
    expect(result).toContain('npm install');
    expect(result).toContain('project');
  });

  it('formats an Edit tool with diff', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'Edit',
      toolInput: {
        file_path: '/home/user/project/src/index.js',
        old_string: 'const a = 1;',
        new_string: 'const a = 2;',
      },
      sessionId: 'sess1',
      cwd: '/home/user/project',
    });
    expect(result).toContain('✏️');
    expect(result).toContain('*Edit*');
    expect(result).toContain('index\\.js');
    expect(result).toContain('const a');
  });

  it('formats a Write tool with line count', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'Write',
      toolInput: {
        file_path: '/tmp/test.txt',
        content: 'line1\nline2\nline3',
      },
      sessionId: 'sess1',
      cwd: '/tmp',
    });
    expect(result).toContain('📝');
    expect(result).toContain('*Write*');
    expect(result).toContain('test\\.txt');
    expect(result).toContain('3 lines');
  });

  it('formats a NotebookEdit tool', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'NotebookEdit',
      toolInput: { notebook_path: '/tmp/notebook.ipynb' },
      sessionId: 'sess1',
      cwd: '/tmp',
    });
    expect(result).toContain('📓');
    expect(result).toContain('notebook\\.ipynb');
  });

  it('formats an unknown tool with generic display', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'CustomTool',
      toolInput: { foo: 'bar' },
      sessionId: 'sess1',
      cwd: '/home/user',
    });
    expect(result).toContain('🔧');
    expect(result).toContain('CustomTool');
  });

  it('shows cwd folder name', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      sessionId: 'sess1',
      cwd: '/very/deep/path/myproject',
    });
    expect(result).toContain('📂');
    expect(result).toContain('myproject');
  });

  it('handles missing cwd', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      sessionId: 'sess1',
      cwd: undefined,
    });
    expect(result).not.toContain('📂');
  });

  it('truncates very long bash commands', () => {
    const longCmd = 'a'.repeat(600);
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'Bash',
      toolInput: { command: longCmd },
      sessionId: 'sess1',
      cwd: '/tmp',
    });
    expect(result).toContain('\\.\\.\\.');
    expect(result.length).toBeLessThan(700);
  });
});

describe('formatToolDetails', () => {
  it('formats Bash details', () => {
    const result = formatToolDetails({
      toolName: 'Bash',
      toolInput: { command: 'echo hello' },
    });
    expect(result).toContain('Full details');
    expect(result).toContain('echo hello');
  });

  it('formats Edit details with file and changes', () => {
    const result = formatToolDetails({
      toolName: 'Edit',
      toolInput: {
        file_path: '/src/app.js',
        old_string: 'old code',
        new_string: 'new code',
      },
    });
    expect(result).toContain('app\\.js');
    expect(result).toContain('Removing');
    expect(result).toContain('Adding');
  });

  it('formats Write details with file and content', () => {
    const result = formatToolDetails({
      toolName: 'Write',
      toolInput: {
        file_path: '/tmp/out.txt',
        content: 'file content here',
      },
    });
    expect(result).toContain('out\\.txt');
    expect(result).toContain('Content');
    expect(result).toContain('file content here');
  });

  it('formats unknown tool as JSON', () => {
    const result = formatToolDetails({
      toolName: 'SomeTool',
      toolInput: { key: 'value' },
    });
    expect(result).toContain('json');
    expect(result).toContain('key');
  });
});

describe('formatNotification', () => {
  it('formats permission_prompt type', () => {
    const result = formatNotification({ type: 'permission_prompt' });
    expect(result).toContain('waiting for permission');
  });

  it('formats generic notification type', () => {
    const result = formatNotification({ type: 'some_event' });
    expect(result).toContain('🔔');
    expect(result).toContain('some\\_event');
  });

  it('handles missing type', () => {
    const result = formatNotification({});
    expect(result).toContain('unknown');
  });
});

describe('formatStop', () => {
  it('formats stop message', () => {
    const result = formatStop({});
    expect(result).toContain('finished');
  });
});

describe('formatStatus', () => {
  it('shows empty queue', () => {
    const result = formatStatus([], false, null);
    expect(result).toContain('No pending approvals');
  });

  it('shows pending items', () => {
    const pending = [
      { id: 'a1', toolName: 'Bash', sessionId: 's1', cwd: '/', createdAt: Date.now(), age: 5 },
      { id: 'a2', toolName: 'Edit', sessionId: 's2', cwd: '/', createdAt: Date.now(), age: 12 },
    ];
    const result = formatStatus(pending, false, null);
    expect(result).toContain('2 pending');
    expect(result).toContain('Bash');
    expect(result).toContain('Edit');
    expect(result).toContain('5s ago');
  });

  it('shows auto-approve info when active', () => {
    const approveUntil = Date.now() + 15 * 60_000;
    const result = formatStatus([], true, approveUntil);
    expect(result).toContain('Auto\\-approve mode');
    expect(result).toContain('15 min');
  });
});
