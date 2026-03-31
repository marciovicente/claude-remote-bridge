import { describe, it, expect } from 'vitest';
import {
  formatToolRequest,
  formatToolDetails,
  formatCompactSummary,
  formatNotification,
  formatStop,
  formatStatus,
} from './formatters.js';

describe('formatToolRequest', () => {
  it('formats a Bash command with code block', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'Bash',
      toolInput: { command: 'npm install' },
      sessionId: 'sess1',
      cwd: '/home/user/project',
    });
    expect(result).toContain('💻');
    expect(result).toContain('<b>Bash</b>');
    expect(result).toContain('npm install');
    expect(result).toContain('language-bash');
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
    expect(result).toContain('<b>Edit</b>');
    expect(result).toContain('index.js');
    expect(result).toContain('const a');
    expect(result).toContain('language-diff');
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
    expect(result).toContain('<b>Write</b>');
    expect(result).toContain('test.txt');
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
    expect(result).toContain('notebook.ipynb');
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

  it('shows session tag with project name', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      sessionId: 'sess1',
      cwd: '/very/deep/path/myproject',
    });
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
    // Should not crash, just no session tag
    expect(result).toContain('Bash');
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
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(700);
  });

  it('escapes HTML entities in tool input', () => {
    const result = formatToolRequest({
      id: 'abc123',
      toolName: 'Bash',
      toolInput: { command: 'echo "<script>alert(1)</script>"' },
      sessionId: 'sess1',
      cwd: '/tmp',
    });
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });
});

describe('formatCompactSummary', () => {
  it('formats Bash command as one-liner', () => {
    const result = formatCompactSummary({
      toolName: 'Bash',
      toolInput: { command: 'npm install' },
      cwd: '/home/user/project',
    });
    expect(result).toContain('💻');
    expect(result).toContain('npm install');
    expect(result).toContain('project');
  });

  it('formats Edit with filename', () => {
    const result = formatCompactSummary({
      toolName: 'Edit',
      toolInput: { file_path: '/src/index.js' },
      cwd: '/src',
    });
    expect(result).toContain('✏️');
    expect(result).toContain('index.js');
  });

  it('formats Write with filename', () => {
    const result = formatCompactSummary({
      toolName: 'Write',
      toolInput: { file_path: '/tmp/out.txt' },
      cwd: '/tmp',
    });
    expect(result).toContain('📝');
    expect(result).toContain('out.txt');
  });

  it('truncates long bash commands to first line', () => {
    const result = formatCompactSummary({
      toolName: 'Bash',
      toolInput: { command: 'line1\nline2\nline3' },
      cwd: '/tmp',
    });
    expect(result).toContain('line1');
    expect(result).not.toContain('line2');
  });
});

describe('formatToolDetails', () => {
  it('formats Bash details with syntax highlighting', () => {
    const result = formatToolDetails({
      toolName: 'Bash',
      toolInput: { command: 'echo hello' },
    });
    expect(result).toContain('language-bash');
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
    expect(result).toContain('app.js');
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
    expect(result).toContain('out.txt');
    expect(result).toContain('file content here');
  });

  it('formats unknown tool as JSON', () => {
    const result = formatToolDetails({
      toolName: 'SomeTool',
      toolInput: { key: 'value' },
    });
    expect(result).toContain('language-json');
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
    expect(result).toContain('some_event');
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
    const result = formatStatus([], false, null, false);
    expect(result).toContain('No pending approvals');
  });

  it('shows pending items with session colors', () => {
    const pending = [
      { id: 'a1', toolName: 'Bash', sessionId: 's1', cwd: '/project-a', createdAt: Date.now(), age: 5 },
      { id: 'a2', toolName: 'Edit', sessionId: 's2', cwd: '/project-b', createdAt: Date.now(), age: 12 },
    ];
    const result = formatStatus(pending, false, null, false);
    expect(result).toContain('2 pending');
    expect(result).toContain('Bash');
    expect(result).toContain('Edit');
    expect(result).toContain('5s ago');
  });

  it('shows auto-approve info when active', () => {
    const approveUntil = Date.now() + 15 * 60_000;
    const result = formatStatus([], true, approveUntil, false);
    expect(result).toContain('Auto-approve');
    expect(result).toContain('15 min');
  });

  it('shows paused state', () => {
    const result = formatStatus([], false, null, true);
    expect(result).toContain('Paused');
  });
});
