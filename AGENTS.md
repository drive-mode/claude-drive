# AGENTS.md — claude-drive

AI agent context for working in this repository.

## What This Project Is

**claude-drive** is a standalone Node.js/TypeScript CLI that brings cursor-drive's multi-operator pair programming to the Claude Code CLI. It runs an MCP server on `:7891` that Claude Code reads tools from, and uses `@anthropic-ai/claude-agent-sdk` to execute operators as subagents.

Ported from `../cursor-drive` (VS Code extension). ~60% of source adapted with VS Code APIs replaced by Node.js equivalents.

## Commands

```bash
npm install          # Install dependencies
npm run compile      # TypeScript → out/
npm run watch        # Watch mode
npm test             # Jest unit tests (--experimental-vm-modules)
npm start            # node out/cli.js start
```

One-shot task:

```bash
node out/cli.js run "add a readme"
```

## Architecture

```
cli.ts → driveMode + operatorRegistry
       → operatorManager (Agent SDK query())
       → mcpServer (localhost:7891) ← registered in ~/.claude/settings.json
       → agentOutput (Ink TUI)
       → tts (edgeTts → piper → say)
       → worktreeManager (git worktree per operator)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point (commander) |
| `src/mcpServer.ts` | MCP server — Drive tools exposed to Claude Code |
| `src/operatorManager.ts` | Wraps Agent SDK `query()` per operator |
| `src/operatorRegistry.ts` | Operator lifecycle (spawn/switch/dismiss/merge) |
| `src/driveMode.ts` | State machine (active + subMode) |
| `src/router.ts` | Routes input to correct operator |
| `src/agentOutput.ts` | Terminal output renderer (Ink/React) |
| `src/tts.ts` | TTS dispatch (edgeTts/piper/say backends) |
| `src/sessionManager.ts` | Session lifecycle |
| `src/worktreeManager.ts` | Git worktree isolation per operator |
| `src/store.ts` | JSON KV store (state persistence) |
| `src/config.ts` | Config loader (`~/.claude-drive/config.json`) |
| `src/syncTypes.ts` | Shared types kept in sync with cursor-drive |

## Coding Conventions

- ESM modules (`"type": "module"` in package.json)
- TypeScript strict mode
- Relative imports use `.js` extension (even for `.ts` source files)
- Named exports preferred over default exports
- `async/await` over raw Promise chains
- Tests in `tests/` using Jest with `ts-jest` ESM preset

## Config

Config file: `~/.claude-drive/config.json`

```bash
node out/cli.js config set tts.backend edgeTts
node out/cli.js config set tts.enabled true
node out/cli.js config set mcp.port 7891
```

## Sync with cursor-drive

When `../cursor-drive` changes key business logic, sync these files manually:

- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` — copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` — keep in sync

## Maintainers

- [@hhalperin](https://github.com/hhalperin) — lead
- [@ai-secretagent](https://github.com/ai-secretagent) — co-maintainer
