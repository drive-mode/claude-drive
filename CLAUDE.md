# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**claude-drive** is a standalone Node.js CLI that brings cursor-drive's multi-operator pair programming to Claude Code CLI. It runs an MCP server on `:7891` that Claude Code reads tools from, and uses `@anthropic-ai/claude-agent-sdk@0.2.77` to execute operators as subagents.

## Commands

```bash
npm install          # Install dependencies
npm run compile      # TypeScript → out/
npm run watch        # Watch mode
npm start            # Start MCP server (node out/cli.js start)
npm test             # Jest unit tests
```

One-shot task:
```bash
node out/cli.js run "add a readme"
```

## Architecture

```
cli.ts → driveMode + operatorRegistry
       → operatorManager (Agent SDK query(), AbortController per operator)
       → mcpServer (localhost:7891) ← registered in ~/.claude/settings.json
       → agentOutput (terminal + optional SSE)
       → tts (edgeTts → piper → say)
       → memoryStore + autoDream (typed memory with confidence decay)
       → checkpoint (session snapshots + fork)
       → hooks (pre/post lifecycle events)
       → skillLoader (dynamic skill registration)
       → approvalGates + approvalQueue (safety gates with operatorId tracking)
```

## Claude Code Integration

Add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "claude-drive": { "url": "http://localhost:7891/mcp" }
  }
}
```

Then `claude-drive start` in one terminal, Claude Code in another.

## Key Files

| File | Purpose |
|---|---|
| `src/cli.ts` | CLI entry point (commander), fail-fast SDK validation |
| `src/mcpServer.ts` | MCP server — Drive tools exposed to Claude Code, maxConcurrent enforcement |
| `src/operatorManager.ts` | Wraps Agent SDK `query()` per operator with AbortController |
| `src/operatorRegistry.ts` | Operator lifecycle (spawn/switch/dismiss/merge), abort on dismiss |
| `src/driveMode.ts` | State machine (active + subMode) |
| `src/agentOutput.ts` | Terminal output renderer |
| `src/tts.ts` | TTS dispatch (edgeTts/piper/say backends) |
| `src/config.ts` | Config loader (`~/.claude-drive/config.json`), atomic writes |
| `src/store.ts` | JSON file KV store (persists state), atomic writes |
| `src/atomicWrite.ts` | Shared atomic write utility (tmp + rename pattern) |
| `src/memoryStore.ts` | Typed memory entries with confidence decay |
| `src/memoryManager.ts` | Memory retrieval and contextual search |
| `src/autoDream.ts` | Automatic memory consolidation during idle |
| `src/checkpoint.ts` | Session state snapshots and fork support |
| `src/hooks.ts` | Pre/post lifecycle hooks for operator events |
| `src/skillLoader.ts` | Dynamic skill loading and registration |
| `src/sessionStore.ts` | Session persistence with atomic writes |
| `src/approvalGates.ts` | Safety gates with per-operator throttling |
| `src/approvalQueue.ts` | Approval queue for dangerous operations |
| `src/worktreeManager.ts` | Git worktree isolation per operator |

## Config

Config file: `~/.claude-drive/config.json`

```bash
node out/cli.js config set tts.backend edgeTts
node out/cli.js config set tts.enabled true
node out/cli.js config set mcp.port 7891
node out/cli.js config set operators.maxConcurrent 3
```

## Persistence & Safety

- All file writes use atomic tmp+rename via `atomicWriteJSON()` — no partial writes on crash
- SDK availability is validated at startup (fail-fast before MCP server launch)
- Operators are capped at `operators.maxConcurrent` (default 3)
- AbortController is wired through operator lifecycle — `dismiss()` cancels running tasks
- Approval gates validate operatorId (empty/undefined falls back to "anonymous")

## Relationship to cursor-drive

This project is a port of `../cursor-drive` (VS Code extension) to standalone CLI. ~60% of source is adapted from cursor-drive with VS Code APIs replaced by Node.js equivalents. When cursor-drive changes key business logic, sync these files manually:
- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` — copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` — keep in sync manually
