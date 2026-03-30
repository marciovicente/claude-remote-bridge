<p align="left">
  <img src="claude-remote-bridge-banner.png" alt="Claude Remote Bridge" width="40%" />
</p>

# Claude Remote Bridge

A Claude Code channel plugin for Telegram with smart approval rules. Control Claude remotely from your phone — approve or deny tool usage with inline buttons, auto-approve safe tools, and send instructions directly from Telegram.

## How It Works

```
Claude Code <--stdio--> Remote Bridge <--Bot API--> Telegram <--> Your Phone
```

Remote Bridge runs as an MCP server that Claude Code spawns as a subprocess. It connects to your Telegram bot using long polling (outbound only, no tunnel needed). When Claude needs to use a tool that requires permission, the request appears in your Telegram chat with Approve/Deny buttons.

Unlike the built-in Telegram channel, Remote Bridge adds **smart approval rules**:
- Read-only tools (Read, Glob, Grep) are auto-approved without bothering you
- Dangerous commands are auto-denied based on configurable patterns
- Temporary bulk approval mode (`/approveall`) for when you trust the flow

## Quick Start

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) v2.1.80 or later
- [Bun](https://bun.sh) runtime installed
- A Telegram account (free)

### Install

```bash
# Clone and install globally
git clone https://github.com/marciovicente/claude-remote-bridge.git
cd claude-remote-bridge
bun install
bun link
```

### Setup and Start

```bash
# Interactive setup — creates a Telegram bot and saves the token
remote-bridge setup

# Start Claude Code with the bridge
remote-bridge start
```

That's it. The `setup` command walks you through creating a Telegram bot via [@BotFather](https://t.me/BotFather) and tests the connection. The `start` command launches Claude Code with the channel enabled.

On first use, send a message to your bot in Telegram. It replies with a pairing code — approve it in your Claude Code session to link your account.

### CLI Commands

```bash
remote-bridge setup    # Interactive setup (create bot, save token)
remote-bridge start    # Start Claude Code with the bridge channel
remote-bridge status   # Show configuration status
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| Send any message | Claude receives it as an instruction and acts on it |
| `/approveall [min]` | Auto-approve all requests for N minutes (default: 30) |
| `/stopapprove` | Disable auto-approve mode |
| `/pause` | Toggle pause — permissions fall back to terminal |
| `/status` | Show bridge status (pending requests, auto-approve, etc.) |
| `/help` | Show available commands |

### Approval Buttons

When Claude tries to use a tool that requires approval, you receive a message with:

- **✅** — approve the tool call
- **❌** — deny the tool call
- **👁** — view full tool input details

## Smart Approval Rules

### Auto-Approve (safe tools)

These tools are approved automatically without a Telegram notification:

- `Read`, `Glob`, `Grep` — file reading
- `WebSearch`, `WebFetch` — web access
- `TodoWrite` — task management

### Auto-Deny (dangerous patterns)

Tool inputs matching these patterns are blocked automatically:

- `rm -rf /`
- `git push --force origin main`
- `git push --force origin master`

### Customization

Edit `~/.claude/channels/remote-bridge/config.json`:

```json
{
  "autoApproveTools": ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"],
  "alwaysDenyPatterns": ["rm -rf /", "git push --force origin main"]
}
```

## How It Compares

| Feature | Built-in Telegram Channel | Remote Bridge |
|---------|--------------------------|---------------|
| Send messages to Claude | Yes | Yes |
| Claude replies in Telegram | Yes | Yes |
| Permission relay (approve/deny) | Text-based ("yes abcde") | Inline buttons |
| Auto-approve safe tools | No | Yes |
| Auto-deny dangerous commands | No | Yes |
| Temporary bulk approval | No | `/approveall` |
| Pause mode | No | `/pause` |

## Architecture

Remote Bridge is a standard MCP server with the `claude/channel` and `claude/channel/permission` capabilities. Claude Code spawns it as a subprocess and communicates over stdio.

- **Channel events**: Telegram messages are pushed to Claude via `notifications/claude/channel`
- **Reply tool**: Claude sends responses back to Telegram via the `reply` MCP tool
- **Permission relay**: Claude Code forwards tool approval prompts; the bridge applies rules or forwards to Telegram with buttons

No HTTP server, no hooks to install, no separate process to manage.

## Security

- The Telegram bot only responds to paired users (sender allowlist)
- Bot token is stored locally in `~/.claude/channels/remote-bridge/.env`
- All communication is outbound (long polling) — nothing is exposed to the network

## Troubleshooting

**Bot doesn't respond to messages:**
- Make sure Claude Code is running with `--channels plugin:remote-bridge@...`
- The bot only works while the channel is active

**Permission prompts not appearing:**
- Check you've paired your account (`/remote-bridge:access list`)
- Check the bridge isn't paused (`/status`)

**Auto-approve not working:**
- Verify the tool name matches exactly (case-sensitive)
- Check `~/.claude/channels/remote-bridge/config.json`

## License

[MIT](LICENSE)
