# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**claude-drive** is a standalone Node.js/TypeScript CLI daemon + MCP server that brings multi-operator AI pair programming to Claude Code CLI. It runs an HTTP MCP server on `:7891`, exposes Drive tools that Claude Code reads, and uses `@anthropic-ai/claude-agent-sdk` to execute operators as subagents.

Ported from `../cursor-drive` (VS Code extension). ~60% of source adapted with VS Code APIs replaced by Node.js equivalents.

## Commands

```bash
npm install          # Install dependencies
npm run compile      # TypeScript -> out/
npm run watch        # Watch mode (tsc -watch)
npm test             # Jest unit tests (uses --experimental-vm-modules)
npm start            # Start MCP server (node out/cli.js start)
```

Run a single test file:
```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/config.test.ts
```

One-shot task:
```bash
node out/cli.js run "refactor the auth module"
```

CI runs `npm ci && npm run build && npm test` on Node 20 (Ubuntu).

## Architecture

```
cli.ts (Commander entry point)
  |-- driveMode.ts            State machine (active + subMode: plan/agent/ask/debug/off)
  |-- operatorRegistry.ts     Named operator pool (spawn/switch/dismiss/escalate)
  |-- operatorManager.ts      Executes operators via @anthropic-ai/claude-agent-sdk query()
  |-- mcpServer.ts            HTTP MCP server on :7891, writes port to ~/.claude-drive/port
  |-- pipeline.ts             Multi-stage prompt processing pipeline (see below)
  |-- agentOutput.ts          Terminal renderer + optional Ink TUI (tui.tsx)
  |-- router.ts               Intent classification to sub-mode
  |-- tts.ts                  TTS dispatch (edgeTts -> piper -> say)
  |-- approvalGates.ts        Safety gates (block/warn/log dangerous ops)
  |-- worktreeManager.ts      Git worktree isolation per operator
  |-- sessionManager.ts       Save/restore operator sessions
  |-- store.ts                JSON file KV store for state persistence
  |-- config.ts               Config loader (~/.claude-drive/config.json)
  |-- governance/             Project graph, entropy analysis, focus guard, task ledger
```

### Prompt Pipeline (`pipeline.ts`)

Prompts flow through: filler cleaning (`fillerCleaner.ts`) -> glossary expansion (`glossaryExpander.ts`) -> sanitization (`sanitizer.ts`) -> approval gates -> memory injection (`sessionMemory.ts`, `persistentMemory.ts`) -> intent routing -> model selection (`modelSelector.ts`).

### Governance Module (`src/governance/`)

Self-analysis subsystem: `projectGraph.ts` builds a file dependency graph, `entropy.ts` computes codebase entropy metrics, `focusGuard.ts` checks task scope drift, `taskLedger.ts` manages structured task tracking, `scan.ts` runs full governance scans.

## Key Conventions

- **ESM TypeScript**: `"type": "module"` in package.json. All relative imports must use `.js` extensions.
- **Named exports only** — no default exports in `src/`.
- **Config access**: `getConfig<T>(key)` to read, `saveConfig(key, value)` to persist. Priority: runtime flags > env (`CLAUDE_DRIVE_*`) > `~/.claude-drive/config.json` > defaults.
- **State directory**: `~/.claude-drive/` stores config, port file, and sessions.
- **Tests**: Jest with `ts-jest` ESM preset. Test files in `tests/*.test.ts`.

## Sync with cursor-drive

When `../cursor-drive` changes key business logic, sync manually:
- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` — copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` — keep in sync
- Do not sync VS Code extension files

## Claude Code Integration

Register in `~/.claude/settings.json`:
```json
{ "mcpServers": { "claude-drive": { "url": "http://localhost:7891/mcp" } } }
```

Or run `claude-drive install` to auto-register.
