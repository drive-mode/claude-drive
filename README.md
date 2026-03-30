# claude-drive

Voice-first, multi-operator AI pair programming for **Claude Code CLI**.

claude-drive gives you a steering wheel for your Claude agents — spawn, switch, and coordinate multiple operators on one codebase, with a live activity feed, TTS narration, and git worktree isolation per operator.

## What It Does

- **Multi-operator orchestration** — spawn named operators (Claude subagents) and switch between them mid-session
- **Voice narration** — TTS output via edgeTts, piper, or system `say` backends
- **Git worktree isolation** — each operator gets its own worktree; merge when done
- **MCP server** — exposes Drive tools to Claude Code via `localhost:7891`
- **Approval gates** — safety checks that block, warn, or log dangerous operations before they run
- **Session persistence** — save and restore operator sessions across restarts
- **One-shot tasks** — run a prompt headlessly without starting a full session
- **Ink TUI** — optional two-pane terminal UI with live activity feed and operator status

Ported from [`cursor-drive`](https://github.com/hhalperin/cursor-drive) (the Cursor IDE extension), replacing VS Code APIs with Node.js equivalents.

## Quick Start

```bash
# 1. Install
git clone https://github.com/hhalperin/claude-drive.git
cd claude-drive
npm install
npm run build

# 2. Register with Claude Code
claude-drive install
# Or manually add to ~/.claude/settings.json:
# { "mcpServers": { "claude-drive": { "url": "http://localhost:7891/mcp" } } }

# 3. Start the daemon (keep running)
claude-drive start

# 4. Open Claude Code in another terminal — Drive tools are now available
```

## Usage

### Start the MCP Server

```bash
claude-drive start              # default port 7891
claude-drive start --port 7892  # custom port
claude-drive start --tui        # Ink TUI mode (two-pane layout)
```

### One-Shot Task

```bash
claude-drive run "refactor the auth module"
```

### Operator Management (CLI)

```bash
claude-drive operator spawn "fix login bug" --role implementer
claude-drive operator list
claude-drive operator switch Alpha
claude-drive operator dismiss Alpha
```

### Drive Mode

```bash
claude-drive mode set agent    # plan | agent | ask | debug | off
claude-drive mode status
```

### Text-to-Speech

```bash
claude-drive tts "Hello from the Drive"
```

### Configuration

```bash
claude-drive config set tts.backend edgeTts
claude-drive config set tts.enabled true
claude-drive config set mcp.port 7891
claude-drive config get tts.backend
```

Config file: `~/.claude-drive/config.json`

### Utility

```bash
claude-drive port     # Print the live MCP URL
claude-drive install  # Register in Claude Code settings
```

## Configuration Reference

All config keys can be set via `claude-drive config set <key> <value>`, env vars (`CLAUDE_DRIVE_*`), or `~/.claude-drive/config.json`. Priority: runtime flags > env vars > config file > defaults.

| Key | Default | Description |
|-----|---------|-------------|
| `tts.enabled` | `true` | Enable TTS narration |
| `tts.backend` | `edgeTts` | TTS backend: `edgeTts`, `piper`, or `say` |
| `tts.speed` | `1.0` | Playback speed |
| `tts.volume` | `0.8` | Playback volume |
| `tts.maxSpokenSentences` | `3` | Max sentences per TTS utterance |
| `operators.maxConcurrent` | `3` | Max simultaneous operators |
| `operators.maxSubagents` | `2` | Max subagents per operator |
| `operators.defaultPermissionPreset` | `standard` | Default permission: `readonly`, `standard`, `full` |
| `mcp.port` | `7891` | MCP server port |
| `mcp.portRange` | `5` | Ports to try on bind failure |
| `drive.defaultMode` | `agent` | Default sub-mode |
| `drive.confirmGates` | `true` | Require approval for dangerous ops |
| `approvalGates.enabled` | `true` | Enable safety gates |
| `router.llmEnabled` | `false` | Use LLM for intent routing |

## Architecture

```
cli.ts
  ├── driveMode.ts          — state machine (active + subMode)
  ├── operatorRegistry.ts   — operator lifecycle (spawn/switch/dismiss/merge)
  ├── operatorManager.ts    — wraps @anthropic-ai/claude-agent-sdk query() per operator
  ├── mcpServer.ts          — MCP server on :7891, exposes Drive tools to Claude Code
  ├── agentOutput.ts        — terminal renderer + optional Ink TUI
  ├── router.ts             — intent classification (plan/agent/ask/debug)
  ├── tts.ts                — TTS dispatch (edgeTts → piper → say)
  ├── approvalGates.ts      — safety gates (block/warn/log patterns)
  ├── worktreeManager.ts    — git worktree isolation per operator
  ├── sessionManager.ts     — save/restore sessions
  ├── store.ts              — JSON KV store (persists state)
  └── config.ts             — config loader (~/.claude-drive/config.json)
```

See [`docs/architecture.md`](docs/architecture.md) for the full architecture guide with diagrams.

## MCP Tools

When claude-drive is running, it exposes 26 tools to Claude Code via MCP. See [`docs/api-reference.md`](docs/api-reference.md) for the complete reference.

Key tool groups: operator management, agent screen logging, TTS, drive mode, task execution, approval gates, git worktrees, and session management.

## Development

```bash
npm run watch    # TypeScript watch mode
npm test         # Jest unit tests
```

See [`docs/onboarding.md`](docs/onboarding.md) for the full contributor guide.

## Relationship to cursor-drive

~60% of source is adapted from [`cursor-drive`](https://github.com/hhalperin/cursor-drive). When cursor-drive changes key business logic, sync these files manually:

- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` — copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` — keep in sync

## Maintainers

- [@hhalperin](https://github.com/hhalperin) — lead
- [@ai-secretagent](https://github.com/ai-secretagent) — co-maintainer

## License

See [LICENSE](LICENSE) for details.
