# Claude Remote Bridge

Control Claude Code remotely from Telegram via HTTP hooks. Approve/deny tool usage with inline buttons, auto-approve safe tools, and send instructions from your phone.

## Architecture

```
Claude Code --HTTP hooks--> Express Server (localhost:3456) --Bot API--> Telegram <--> User's Phone
```

The bridge is a local Express server (NOT an MCP server or channel plugin). It integrates with Claude Code via **HTTP hooks** installed in `~/.claude/settings.json`.

### Hook flow

1. **PreToolUse** (`POST /hooks/pre-tool-use`) — intercepts risky tools (Bash, Edit, Write, NotebookEdit). The HTTP connection is held open until the user responds via Telegram or timeout (300s).
2. **Notification** (`POST /hooks/notification`) — forwards notifications to Telegram (async, returns immediately).
3. **Stop** (`POST /hooks/stop`) — notifies Telegram when Claude finishes (async).

### Smart approval rules (evaluated in order)

1. Bridge paused → fall back to terminal
2. Tool in `autoApproveTools` → auto-approve
3. Tool input matches `alwaysDenyPatterns` → auto-deny
4. Request from `/run` session → auto-approve
5. `/approveall` mode active → auto-approve
6. Otherwise → send to Telegram with Approve/Deny buttons

## Project structure

```
bin/cli.js                  — CLI entry point (commander.js)
src/server.js               — Express server, hook endpoints, approval logic
src/telegram.js             — Telegraf bot, commands, callback handlers
src/queue.js                — In-memory approval queue with promise-based waiting
src/config.js               — Config load/save (~/.claude-remote-bridge/config.json)
src/formatters.js           — Telegram message formatting helpers
src/hooks-installer.js      — Install/remove hooks in ~/.claude/settings.json
setup/interactive-setup.js  — Interactive setup wizard
```

## Key conventions

- **Runtime**: Node.js 18+ (ESM modules, `"type": "module"`)
- **No TypeScript** — plain JS with JSDoc comments where needed
- **Dependencies**: express, telegraf, commander, chalk, nanoid
- **Config storage**: `~/.claude-remote-bridge/config.json` (NOT under `~/.claude/`)
- **PID file**: `~/.claude-remote-bridge/server.pid`
- **Server binds to `127.0.0.1` only** (never `0.0.0.0`)
- **Telegram uses long polling** (outbound only, no tunnel/webhook)

## CLI command

```bash
claude-remote-bridge setup            # Interactive setup
claude-remote-bridge start [-d]       # Start server (optionally detached)
claude-remote-bridge stop             # Stop background server
claude-remote-bridge status           # Show status
claude-remote-bridge test             # Send test message to Telegram
claude-remote-bridge hooks-install    # Install hooks only
claude-remote-bridge hooks-uninstall  # Remove hooks
```

## Development

```bash
npm install
node bin/cli.js start   # Run locally without global link
```

Tests use vitest: `npx vitest`
