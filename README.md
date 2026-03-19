# claude-drive

Voice-first, multi-operator AI pair programming for **Claude Code CLI**.

claude-drive gives you a steering wheel for your Claude agents — spawn, switch, and coordinate multiple operators on one codebase, with a live activity feed, TTS narration, and git worktree isolation per operator.

## What It Does

- **Multi-operator orchestration** — spawn named operators (Claude subagents) and switch between them mid-session
- **Voice narration** — TTS output via edgeTts, piper, or system `say` backends
- **Git worktree isolation** — each operator gets its own worktree; merge when done
- **MCP server** — exposes Drive tools to Claude Code via `localhost:7891`
- **OpenTelemetry observability** — trace operator activity and session state
- **One-shot tasks** — run a prompt headlessly without starting a full session

Ported from [`cursor-drive`](https://github.com/hhalperin/cursor-drive) (the Cursor IDE extension), replacing VS Code APIs with Node.js equivalents.

## Install

```bash
npm install
npm run build
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
```

Config file: `~/.claude-drive/config.json`

## Architecture

```
cli.ts
  ├── driveMode.ts          — state machine (active operator + subMode)
  ├── operatorRegistry.ts   — operator lifecycle (spawn/switch/dismiss/merge)
  ├── operatorManager.ts    — wraps @anthropic-ai/claude-agent-sdk query() per operator
  ├── mcpServer.ts          — MCP server on :7891, exposes Drive tools to Claude Code
  ├── agentOutput.ts        — terminal renderer (Ink/React TUI)
  ├── tts.ts                — TTS dispatch (edgeTts → piper → say)
  ├── sessionManager.ts     — session lifecycle
  ├── worktreeManager.ts    — git worktree create/merge/cleanup
  ├── store.ts              — JSON KV store (persists state to disk)
  └── config.ts             — config loader (~/.claude-drive/config.json)
```

## Development

```bash
npm run watch    # TypeScript watch mode
npm test         # Jest unit tests
```

## Relationship to cursor-drive

~60% of source is adapted from [`cursor-drive`](https://github.com/hhalperin/cursor-drive). When cursor-drive changes key business logic, sync these files manually:

- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` — copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` — keep in sync

## Maintainers

- [@hhalperin](https://github.com/hhalperin)
- [@ai-secretagent](https://github.com/ai-secretagent)
