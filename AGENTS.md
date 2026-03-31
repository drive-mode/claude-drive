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
cli.ts
  ├── driveMode.ts              — state machine (active + subMode)
  ├── operatorRegistry.ts       — operator lifecycle (spawn/switch/dismiss/merge)
  ├── operatorManager.ts        — wraps Agent SDK query() per operator
  ├── mcpServer.ts              — MCP server on :7891 + /health + /shutdown
  ├── pipeline.ts               — multi-stage prompt processing pipeline
  ├── agentOutput.ts            — terminal renderer + optional Ink TUI
  ├── tui.tsx                   — Ink two-pane TUI component
  ├── router.ts                 — intent classification (plan/agent/ask/debug)
  ├── modelSelector.ts          — tiered model routing (routing/planning/execution/reasoning)
  ├── tts.ts                    — TTS dispatch (edgeTts → piper → say)
  ├── edgeTts.ts                — Edge TTS backend
  ├── piper.ts                  — Piper TTS backend
  ├── commsAgent.ts             — batched operator status reporting
  ├── approvalGates.ts          — safety gates (block/warn/log patterns)
  ├── approvalQueue.ts          — queued approval request management
  ├── sanitizer.ts              — prompt injection prevention + truncation
  ├── fillerCleaner.ts          — dictation filler word removal
  ├── glossaryExpander.ts       — glossary trigger expansion
  ├── tangentNameExtractor.ts   — extract tangent names from prompts
  ├── tangentFlow.ts            — tangent management and tracking
  ├── toolAllowlist.ts          — MCP tool permission enforcement per preset
  ├── worktreeManager.ts        — git worktree isolation per operator
  ├── gitService.ts             — low-level git operations
  ├── sessionManager.ts         — save/restore sessions
  ├── sessionMemory.ts          — in-session operator memory (turns/decisions/tasks)
  ├── sessionStore.ts           — session persistence backend
  ├── persistentMemory.ts       — two-layer persistent memory (curated + daily logs)
  ├── syncLedger.ts             — cross-operator sync event ledger
  ├── syncTypes.ts              — shared types kept in sync with cursor-drive
  ├── stateSyncCoordinator.ts   — real-time state synchronization between operators
  ├── integrationQueue.ts       — queued merge/integration operations
  ├── store.ts                  — JSON KV store (persists state)
  ├── config.ts                 — config loader (~/.claude-drive/config.json)
  └── governance/               — project governance subsystem
      ├── index.ts              — governance module barrel export
      ├── types.ts              — governance type definitions
      ├── entropy.ts            — codebase entropy scoring
      ├── focusGuard.ts         — operator focus drift detection
      ├── projectGraph.ts       — project dependency graph
      ├── taskLedger.ts         — task tracking and assignment ledger
      └── scan.ts               — governance scan runner
```

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point (commander) |
| `src/mcpServer.ts` | MCP server — Drive tools exposed to Claude Code |
| `src/operatorManager.ts` | Wraps Agent SDK `query()` per operator |
| `src/operatorRegistry.ts` | Operator lifecycle (spawn/switch/dismiss/merge) |
| `src/driveMode.ts` | State machine (active + subMode) |
| `src/pipeline.ts` | Multi-stage prompt processing pipeline |
| `src/router.ts` | Routes input to correct operator |
| `src/modelSelector.ts` | Tiered model routing (routing/planning/execution/reasoning) |
| `src/agentOutput.ts` | Terminal output renderer (Ink/React) |
| `src/tui.tsx` | Ink two-pane TUI component |
| `src/tts.ts` | TTS dispatch (edgeTts/piper/say backends) |
| `src/edgeTts.ts` | Edge TTS backend |
| `src/piper.ts` | Piper TTS backend |
| `src/commsAgent.ts` | Batched operator status reporting |
| `src/approvalGates.ts` | Safety gates (block/warn/log patterns) |
| `src/approvalQueue.ts` | Queued approval request management |
| `src/sanitizer.ts` | Prompt injection prevention + truncation |
| `src/fillerCleaner.ts` | Dictation filler word removal |
| `src/glossaryExpander.ts` | Glossary trigger expansion |
| `src/tangentNameExtractor.ts` | Extract tangent names from prompts |
| `src/tangentFlow.ts` | Tangent management and tracking |
| `src/toolAllowlist.ts` | MCP tool permission enforcement per preset |
| `src/worktreeManager.ts` | Git worktree isolation per operator |
| `src/gitService.ts` | Low-level git operations |
| `src/sessionManager.ts` | Save/restore sessions |
| `src/sessionMemory.ts` | In-session operator memory (turns/decisions/tasks) |
| `src/sessionStore.ts` | Session persistence backend |
| `src/persistentMemory.ts` | Two-layer persistent memory (curated + daily logs) |
| `src/syncLedger.ts` | Cross-operator sync event ledger |
| `src/syncTypes.ts` | Shared types kept in sync with cursor-drive |
| `src/stateSyncCoordinator.ts` | Real-time state synchronization between operators |
| `src/integrationQueue.ts` | Queued merge/integration operations |
| `src/store.ts` | JSON KV store (state persistence) |
| `src/config.ts` | Config loader (`~/.claude-drive/config.json`) |
| `src/governance/` | Project governance subsystem (entropy, focus guard, task ledger, project graph, scan) |

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
