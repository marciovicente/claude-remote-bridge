/**
 * Format tool usage details into readable Telegram messages.
 * Uses Telegram MarkdownV2 formatting.
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

function escapeMarkdown(text) {
  if (!text) return '';
  // Telegram MarkdownV2 requires escaping these characters
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function truncate(str, maxLen = 300) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

/**
 * Format a tool request into a clean Telegram message.
 * Focuses on the actual content — what command, what file, what change.
 */
export function formatToolRequest({ id, toolName, toolInput, sessionId, cwd }) {
  const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const lines = [];

  if (toolName === 'Bash' && toolInput?.command) {
    lines.push(`${icon} *Bash*`);
    lines.push(`\`\`\`bash`);
    lines.push(escapeMarkdown(truncate(toolInput.command, 500)));
    lines.push(`\`\`\``);
  } else if ((toolName === 'Edit') && toolInput?.file_path) {
    const filename = toolInput.file_path.split('/').pop();
    lines.push(`${icon} *Edit* \`${escapeMarkdown(filename)}\``);
    if (toolInput.old_string && toolInput.new_string) {
      lines.push(`\`\`\`diff`);
      const oldLines = toolInput.old_string.split('\n');
      const newLines = toolInput.new_string.split('\n');
      for (const line of oldLines.slice(0, 15)) {
        lines.push(escapeMarkdown(`- ${line}`));
      }
      if (oldLines.length > 15) lines.push(escapeMarkdown(`... +${oldLines.length - 15} more`));
      for (const line of newLines.slice(0, 15)) {
        lines.push(escapeMarkdown(`+ ${line}`));
      }
      if (newLines.length > 15) lines.push(escapeMarkdown(`... +${newLines.length - 15} more`));
      lines.push(`\`\`\``);
    }
  } else if (toolName === 'Write' && toolInput?.file_path) {
    const filename = toolInput.file_path.split('/').pop();
    const lineCount = toolInput.content ? toolInput.content.split('\n').length : 0;
    lines.push(`${icon} *Write* \`${escapeMarkdown(filename)}\` \\(${lineCount} lines\\)`);
  } else if (toolName === 'NotebookEdit' && toolInput?.notebook_path) {
    const filename = toolInput.notebook_path.split('/').pop();
    lines.push(`${icon} *NotebookEdit* \`${escapeMarkdown(filename)}\``);
  } else {
    lines.push(`${icon} *${escapeMarkdown(toolName)}*`);
    const keys = Object.keys(toolInput || {}).slice(0, 2);
    for (const key of keys) {
      const val = typeof toolInput[key] === 'string'
        ? truncate(toolInput[key], 100)
        : JSON.stringify(toolInput[key]).slice(0, 100);
      lines.push(`\`${escapeMarkdown(val)}\``);
    }
  }

  if (cwd) {
    const folder = cwd.split('/').pop();
    lines.push(`📂 \`${escapeMarkdown(folder)}\``);
  }

  return lines.join('\n');
}

/**
 * Format full tool input details (for "View Details" button)
 */
export function formatToolDetails({ toolName, toolInput }) {
  const parts = [];
  parts.push(`🔧 Full details for ${toolName}:\n`);

  if (toolName === 'Bash' && toolInput?.command) {
    parts.push('```bash');
    parts.push(escapeMarkdown(truncate(toolInput.command, 2000)));
    parts.push('```');
  } else if (toolName === 'Edit' && toolInput) {
    if (toolInput.file_path) {
      parts.push(`*File:* \`${escapeMarkdown(toolInput.file_path)}\`\n`);
    }
    if (toolInput.old_string) {
      parts.push('*Removing:*');
      parts.push('```');
      parts.push(escapeMarkdown(truncate(toolInput.old_string, 800)));
      parts.push('```');
    }
    if (toolInput.new_string) {
      parts.push('*Adding:*');
      parts.push('```');
      parts.push(escapeMarkdown(truncate(toolInput.new_string, 800)));
      parts.push('```');
    }
  } else if (toolName === 'Write' && toolInput) {
    if (toolInput.file_path) {
      parts.push(`*File:* \`${escapeMarkdown(toolInput.file_path)}\`\n`);
    }
    if (toolInput.content) {
      parts.push('*Content:*');
      parts.push('```');
      parts.push(escapeMarkdown(truncate(toolInput.content, 1500)));
      parts.push('```');
    }
  } else {
    parts.push('```json');
    parts.push(escapeMarkdown(truncate(JSON.stringify(toolInput, null, 2), 2000)));
    parts.push('```');
  }

  return parts.join('\n');
}

/**
 * Format a notification message
 */
export function formatNotification(data) {
  if (data.type === 'permission_prompt') {
    return '⚠️ Claude is waiting for permission in the terminal\\.';
  }
  return `🔔 Notification: \`${escapeMarkdown(data.type || 'unknown')}\``;
}

/**
 * Format a stop event
 */
export function formatStop(data) {
  return '✅ Claude finished and is waiting for your next prompt\\.';
}

/**
 * Format the pending queue as a status message
 */
export function formatStatus(pendingList, isAutoApproving, approveUntil) {
  const lines = [];
  lines.push('📊 *Claude Remote Bridge Status*\n');

  if (isAutoApproving) {
    const remaining = Math.round((approveUntil - Date.now()) / 60000);
    lines.push(`🟢 *Auto\\-approve mode:* ${remaining} min remaining\n`);
  }

  if (pendingList.length === 0) {
    lines.push('✅ No pending approvals');
  } else {
    lines.push(`⏳ *${pendingList.length} pending approval\\(s\\):*\n`);
    for (const item of pendingList) {
      const icon = TOOL_ICONS[item.toolName] || TOOL_ICONS.default;
      lines.push(`${icon} \`${escapeMarkdown(item.toolName)}\` \\- ${item.age}s ago \\(\`${escapeMarkdown(item.id)}\`\\)`);
    }
  }

  return lines.join('\n');
}
