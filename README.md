# claude-drive

Voice-first, multi-operator AI pair programming for **Claude Code CLI**.

claude-drive gives you a steering wheel for your Claude agents — spawn, switch, and coordinate multiple operators on one codebase, with a live activity feed, TTS narration, and git worktree isolation per operator.

## What It Does

- **Multi-operator orchestration** — spawn named operators (Claude subagents) and switch between them mid-session, with configurable concurrency limits (default 3)
- **Voice narration** — TTS output via edgeTts, piper, or system `say` backends
- **Git worktree isolation** — each operator gets its own worktree; merge when done
- **MCP server** — exposes Drive tools to Claude Code via `localhost:7891`
- **Approval gates** — safety checks that block, warn, or log dangerous operations before they run
- **Session persistence** — save and restore operator sessions across restarts
- **MCP server** — exposes 46+ Drive tools to Claude Code via `localhost:7891`
- **Task cancellation** — AbortController wired through operator lifecycle; `dismiss` cancels running tasks and cascades to children
- **Structured memory** — typed memory entries with confidence decay, contextual retrieval, and automatic consolidation (auto-dream)
- **Session checkpoints** — snapshot and fork session state at any point
- **Lifecycle hooks** — pre/post hooks for operator events
- **Dynamic skills** — load and register skills at runtime
- **Safety gates** — approval gates with per-operator throttling for dangerous operations
- **Atomic persistence** — all file writes use tmp+rename pattern to prevent corruption
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
npm run compile
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
claude-drive config set operators.maxConcurrent 3
```

Config file: `~/.claude-drive/config.json`

### Daemon Control

```bash
claude-drive stop             # Stop the running daemon (POST /shutdown)
claude-drive port             # Print the live MCP URL
claude-drive port --json      # Output as JSON: { url, port }
claude-drive install          # Register in Claude Code + Claude Desktop settings
```

### Health Check

```bash
curl http://localhost:7891/health
# → { "status": "ok", "uptime": 42.1, "port": 7891, "operators": 2 }
```

## CLI Quick Reference

| Command | Description |
|---------|-------------|
| `claude-drive start` | Start MCP server daemon |
| `claude-drive start --tui` | Start with Ink two-pane TUI |
| `claude-drive stop` | Stop the running daemon |
| `claude-drive run "task"` | One-shot task execution |
| `claude-drive port [--json]` | Print live MCP URL |
| `claude-drive install` | Register in Claude Code settings |
| `claude-drive operator spawn` | Spawn a new operator |
| `claude-drive operator list` | List active operators |
| `claude-drive operator switch <name>` | Switch foreground operator |
| `claude-drive operator dismiss <name>` | Dismiss an operator |
| `claude-drive mode set <mode>` | Set drive sub-mode |
| `claude-drive mode status` | Show current drive state |
| `claude-drive tts "text"` | Speak text via TTS |
| `claude-drive config set <key> <value>` | Set config value |
| `claude-drive config get <key>` | Get config value |
| `claude-drive serve-stdio` | Run MCP over stdin/stdout (plugin mode) |

## Hooks

claude-drive ships a `hooks/hooks.json` file that Claude Code can use to auto-check daemon status on session start. Copy or symlink it into your project's `.claude/` directory.

## Skills

The `.claude-plugin/` directory contains Claude Code plugin packaging:
- `/drive-status` — Show current drive state and operator status
- `/drive-mode` — Switch drive modes and manage operators
- `/run-operator` — Dispatch tasks to operators

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
| `operators.timeoutMs` | `300000` | Operator execution timeout (ms) |
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
  ├── mcpServer.ts          — MCP server on :7891 + /health + /shutdown endpoints
  ├── pipeline.ts           — multi-stage prompt processing pipeline
  ├── agentOutput.ts        — terminal renderer + optional Ink TUI
  ├── router.ts             — intent classification (plan/agent/ask/debug)
  ├── modelSelector.ts      — tiered model routing (routing/planning/execution/reasoning)
  ├── tts.ts                — TTS dispatch (edgeTts → piper → say)
  ├── commsAgent.ts         — batched operator status reporting
  ├── approvalGates.ts      — safety gates (block/warn/log patterns)
  ├── sanitizer.ts          — prompt injection prevention + truncation
  ├── fillerCleaner.ts      — dictation filler word removal
  ├── glossaryExpander.ts   — glossary trigger expansion
  ├── toolAllowlist.ts      — MCP tool permission enforcement per preset
  ├── worktreeManager.ts    — git worktree isolation per operator
  ├── sessionManager.ts     — save/restore sessions
  ├── sessionMemory.ts      — in-session operator memory (turns/decisions/tasks)
  ├── persistentMemory.ts   — two-layer persistent memory (curated + daily logs)
  ├── store.ts              — JSON KV store (persists state)
  ├── config.ts             — config loader (~/.claude-drive/config.json)
  └── governance/           — project graph, entropy, focus guard, task ledger
cli.ts (fail-fast SDK validation)
  ├── driveMode.ts          — state machine (active operator + subMode)
  ├── operatorRegistry.ts   — operator lifecycle (spawn/switch/dismiss/merge + AbortController)
  ├── operatorManager.ts    — wraps @anthropic-ai/claude-agent-sdk query() per operator
  ├── mcpServer.ts          — MCP server on :7891, exposes Drive tools, maxConcurrent enforcement
  ├── agentOutput.ts        — terminal renderer (Ink/React TUI)
  ├── tts.ts                — TTS dispatch (edgeTts → piper → say)
  ├── memoryStore.ts        — typed memory entries with confidence decay
  ├── memoryManager.ts      — memory retrieval and contextual search
  ├── autoDream.ts          — automatic memory consolidation during idle
  ├── checkpoint.ts         — session state snapshots and fork support
  ├── hooks.ts              — pre/post lifecycle hooks for operator events
  ├── skillLoader.ts        — dynamic skill loading and registration
  ├── approvalGates.ts      — safety gates with per-operator throttling
  ├── approvalQueue.ts      — approval queue for dangerous operations
  ├── sessionManager.ts     — session lifecycle
  ├── sessionStore.ts       — session persistence (atomic writes)
  ├── worktreeManager.ts    — git worktree create/merge/cleanup
  ├── atomicWrite.ts        — shared atomic write utility (tmp + rename)
  ├── store.ts              — JSON KV store (persists state, atomic writes)
  └── config.ts             — config loader (~/.claude-drive/config.json)
```

See [`docs/architecture.md`](docs/architecture.md) for the full architecture guide with diagrams.

## MCP Tools

When claude-drive is running, it exposes 42+ tools to Claude Code via MCP. See [`docs/api-reference.md`](docs/api-reference.md) for the complete reference.

Key tool groups: operator management, agent screen logging, TTS, drive mode, task execution, approval gates, git worktrees, and session management.

## Development

```bash
npm run compile  # TypeScript build
npm run watch    # TypeScript watch mode
npm test         # Jest unit tests (176 tests across 17 files)
```

See [`docs/onboarding.md`](docs/onboarding.md) for the full contributor guide.
## Pinned Dependencies

SDK versions are pinned to exact versions (not `latest`) for reproducible builds:

- `@anthropic-ai/claude-agent-sdk@0.2.77`
- `@anthropic-ai/sdk@0.79.0`

## Relationship to cursor-drive

~60% of source is adapted from [`cursor-drive`](https://github.com/hhalperin/cursor-drive). When cursor-drive changes key business logic, sync these files manually:

- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` — copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` — keep in sync

## Maintainers

- [@hhalperin](https://github.com/hhalperin) — lead
- [@ai-secretagent](https://github.com/ai-secretagent) — co-maintainer

## License

See [LICENSE](LICENSE) for details.
