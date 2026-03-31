/**
 * Format tool usage details into readable Telegram messages.
 * Uses Telegram HTML formatting (more reliable than MarkdownV2).
 */

const TOOL_ICONS = {
  Bash: '💻',
  Edit: '✏️',
  Write: '📝',
  NotebookEdit: '📓',
  Read: '📖',
  Glob: '🔍',
  Grep: '🔎',
  WebFetch: '🌐',
  WebSearch: '🔍',
  Task: '🤖',
  default: '🔧',
};

// Assign a colored circle to each session based on session_id hash
const SESSION_COLORS = ['🔵', '🟢', '🟡', '🟠', '🟣', '🔴', '⚪'];

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(str, maxLen = 300) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

function sessionColor(sessionId) {
  if (!sessionId) return '⚪';
  const hash = [...sessionId].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return SESSION_COLORS[hash % SESSION_COLORS.length];
}

function projectName(cwd) {
  if (!cwd) return '';
  return cwd.split('/').pop();
}

/**
 * Format session tag: colored dot + project folder
 */
function sessionTag(sessionId, cwd) {
  const color = sessionColor(sessionId);
  const project = projectName(cwd);
  if (!project) return '';
  return `${color} <code>${escapeHtml(project)}</code>`;
}

/**
 * Compact one-liner summary for post-decision display.
 */
export function formatCompactSummary({ toolName, toolInput, cwd }) {
  const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const project = projectName(cwd);
  const projectTag = project ? ` <code>${escapeHtml(project)}</code>` : '';

  if (toolName === 'Bash' && toolInput?.command) {
    const cmd = truncate(toolInput.command.split('\n')[0], 60);
    return `${icon} <code>${escapeHtml(cmd)}</code>${projectTag}`;
  }
  if ((toolName === 'Edit' || toolName === 'Write') && toolInput?.file_path) {
    const filename = toolInput.file_path.split('/').pop();
    return `${icon} <code>${escapeHtml(filename)}</code>${projectTag}`;
  }
  if (toolName === 'NotebookEdit' && toolInput?.notebook_path) {
    const filename = toolInput.notebook_path.split('/').pop();
    return `${icon} <code>${escapeHtml(filename)}</code>${projectTag}`;
  }
  return `${icon} ${escapeHtml(toolName)}${projectTag}`;
}

/**
 * Format a tool request into a Telegram message with full context.
 */
export function formatToolRequest({ id, toolName, toolInput, sessionId, cwd }) {
  const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const tag = sessionTag(sessionId, cwd);
  const lines = [];

  if (toolName === 'Bash' && toolInput?.command) {
    lines.push(`${icon} <b>Bash</b>`);
    lines.push(`<pre><code class="language-bash">${escapeHtml(truncate(toolInput.command, 500))}</code></pre>`);
  } else if (toolName === 'Edit' && toolInput?.file_path) {
    const filename = toolInput.file_path.split('/').pop();
    lines.push(`${icon} <b>Edit</b> <code>${escapeHtml(filename)}</code>`);
    if (toolInput.old_string && toolInput.new_string) {
      const diffLines = [];
      const oldLines = toolInput.old_string.split('\n');
      const newLines = toolInput.new_string.split('\n');
      for (const line of oldLines.slice(0, 15)) {
        diffLines.push(`- ${line}`);
      }
      if (oldLines.length > 15) diffLines.push(`... +${oldLines.length - 15} more`);
      for (const line of newLines.slice(0, 15)) {
        diffLines.push(`+ ${line}`);
      }
      if (newLines.length > 15) diffLines.push(`... +${newLines.length - 15} more`);
      lines.push(`<pre><code class="language-diff">${escapeHtml(diffLines.join('\n'))}</code></pre>`);
    }
  } else if (toolName === 'Write' && toolInput?.file_path) {
    const filename = toolInput.file_path.split('/').pop();
    const lineCount = toolInput.content ? toolInput.content.split('\n').length : 0;
    lines.push(`${icon} <b>Write</b> <code>${escapeHtml(filename)}</code> (${lineCount} lines)`);
  } else if (toolName === 'NotebookEdit' && toolInput?.notebook_path) {
    const filename = toolInput.notebook_path.split('/').pop();
    lines.push(`${icon} <b>NotebookEdit</b> <code>${escapeHtml(filename)}</code>`);
  } else {
    lines.push(`${icon} <b>${escapeHtml(toolName)}</b>`);
    const keys = Object.keys(toolInput || {}).slice(0, 2);
    for (const key of keys) {
      const val = typeof toolInput[key] === 'string'
        ? truncate(toolInput[key], 100)
        : JSON.stringify(toolInput[key]).slice(0, 100);
      lines.push(`<code>${escapeHtml(val)}</code>`);
    }
  }

  if (tag) lines.push(tag);

  return lines.join('\n');
}

/**
 * Format full tool input details (for "View Details" button)
 */
export function formatToolDetails({ toolName, toolInput }) {
  const parts = [];

  if (toolName === 'Bash' && toolInput?.command) {
    parts.push(`<pre><code class="language-bash">${escapeHtml(truncate(toolInput.command, 2000))}</code></pre>`);
  } else if (toolName === 'Edit' && toolInput) {
    if (toolInput.file_path) {
      parts.push(`<b>File:</b> <code>${escapeHtml(toolInput.file_path)}</code>\n`);
    }
    if (toolInput.old_string) {
      parts.push('<b>Removing:</b>');
      parts.push(`<pre>${escapeHtml(truncate(toolInput.old_string, 800))}</pre>`);
    }
    if (toolInput.new_string) {
      parts.push('<b>Adding:</b>');
      parts.push(`<pre>${escapeHtml(truncate(toolInput.new_string, 800))}</pre>`);
    }
  } else if (toolName === 'Write' && toolInput) {
    if (toolInput.file_path) {
      parts.push(`<b>File:</b> <code>${escapeHtml(toolInput.file_path)}</code>\n`);
    }
    if (toolInput.content) {
      parts.push(`<pre>${escapeHtml(truncate(toolInput.content, 1500))}</pre>`);
    }
  } else {
    parts.push(`<pre><code class="language-json">${escapeHtml(truncate(JSON.stringify(toolInput, null, 2), 2000))}</code></pre>`);
  }

  return parts.join('\n');
}

/**
 * Format a notification message
 */
export function formatNotification(data) {
  if (data.type === 'permission_prompt') {
    return '⚠️ Claude is waiting for permission in the terminal.';
  }
  return `🔔 <code>${escapeHtml(data.type || 'unknown')}</code>`;
}

/**
 * Format a stop event
 */
export function formatStop(data) {
  return '✅ Claude finished and is waiting for your next prompt.';
}

/**
 * Format the pending queue as a status message
 */
export function formatStatus(pendingList, isAutoApproving, approveUntil, paused) {
  const lines = [];
  lines.push('<b>Claude Remote Bridge</b>\n');

  if (paused) {
    lines.push('⏸ <b>Paused</b> — requests fall back to terminal\n');
  }

  if (isAutoApproving) {
    const remaining = Math.round((approveUntil - Date.now()) / 60000);
    lines.push(`🟢 <b>Auto-approve:</b> ${remaining} min remaining\n`);
  }

  if (pendingList.length === 0) {
    lines.push('No pending approvals.');
  } else {
    lines.push(`<b>${pendingList.length} pending:</b>\n`);
    for (const item of pendingList) {
      const icon = TOOL_ICONS[item.toolName] || TOOL_ICONS.default;
      const color = sessionColor(item.sessionId);
      const project = projectName(item.cwd);
      const projectTag = project ? ` ${color} <code>${escapeHtml(project)}</code>` : '';
      lines.push(`  ${icon} <code>${escapeHtml(item.toolName)}</code> — ${item.age}s ago${projectTag}`);
    }
  }

  return lines.join('\n');
}

export { escapeHtml, sessionColor, projectName, TOOL_ICONS };
