# claude-drive

Voice-first, multi-operator AI pair programming for **Claude Code CLI**.

claude-drive gives you a steering wheel for your Claude agents — spawn, switch, and coordinate multiple operators on one codebase, with a live activity feed, TTS narration, and git worktree isolation per operator.

## What It Does

- **Multi-operator orchestration** — spawn named operators (Claude subagents) and switch between them mid-session, with configurable concurrency limits (default 3)
- **Voice narration** — TTS output via edgeTts, piper, or system `say` backends
- **Git worktree isolation** — each operator gets its own worktree; merge when done
- **MCP server** — exposes 46+ Drive tools to Claude Code via `localhost:7891`
- **Task cancellation** — AbortController wired through operator lifecycle; `dismiss` cancels running tasks and cascades to children
- **Structured memory** — typed memory entries with confidence decay, contextual retrieval, and automatic consolidation (auto-dream)
- **Session checkpoints** — snapshot and fork session state at any point
- **Lifecycle hooks** — pre/post hooks for operator events
- **Dynamic skills** — load and register skills at runtime
- **Safety gates** — approval gates with per-operator throttling for dangerous operations
- **Atomic persistence** — all file writes use tmp+rename pattern to prevent corruption
- **One-shot tasks** — run a prompt headlessly without starting a full session

Ported from [`cursor-drive`](https://github.com/hhalperin/cursor-drive) (the Cursor IDE extension), replacing VS Code APIs with Node.js equivalents.

## Install

```bash
npm install
npm run compile
```

Global install (optional):

```bash
npm install -g .
```

## Setup: Claude Code Integration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "claude-drive": { "url": "http://localhost:7891/mcp" }
  }
}
```

## Usage

```bash
# Start the MCP server (keep running in a separate terminal)
claude-drive start

# One-shot task
claude-drive run "refactor the auth module"

# Config
claude-drive config set tts.backend edgeTts
claude-drive config set tts.enabled true
claude-drive config set mcp.port 7891
claude-drive config set operators.maxConcurrent 3
```

Config file: `~/.claude-drive/config.json`

## Architecture

```
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

## Development

```bash
npm run compile  # TypeScript build
npm run watch    # TypeScript watch mode
npm test         # Jest unit tests (176 tests across 17 files)
```

## Pinned Dependencies

SDK versions are pinned to exact versions (not `latest`) for reproducible builds:

- `@anthropic-ai/claude-agent-sdk@0.2.77`
- `@anthropic-ai/sdk@0.79.0`

## Relationship to cursor-drive

~60% of source is adapted from [`cursor-drive`](https://github.com/hhalperin/cursor-drive). When cursor-drive changes key business logic, sync these files manually:

- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` — copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` — keep in sync

## Maintainers

- [@hhalperin](https://github.com/hhalperin)
- [@ai-secretagent](https://github.com/ai-secretagent)
