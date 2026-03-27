# AGENTS.md — claude-drive

AI agent context for working in this repository.

## What This Project Is

**claude-drive** is a standalone Node.js/TypeScript CLI that brings cursor-drive's multi-operator pair programming to the Claude Code CLI. It runs an MCP server on `:7891` that Claude Code reads tools from, and uses `@anthropic-ai/claude-agent-sdk@0.2.77` to execute operators as subagents.

Ported from `../cursor-drive` (VS Code extension). ~60% of source adapted with VS Code APIs replaced by Node.js equivalents.

## Commands

```bash
npm install          # Install dependencies
npm run compile      # TypeScript → out/
npm run watch        # Watch mode
npm test             # Jest unit tests (176 tests, --experimental-vm-modules)
npm start            # node out/cli.js start
```

One-shot task:

```bash
node out/cli.js run "add a readme"
```

## Architecture

```
cli.ts (fail-fast SDK validation)
       → driveMode + operatorRegistry (AbortController on dismiss)
       → operatorManager (Agent SDK query(), AbortController per operator)
       → mcpServer (localhost:7891, maxConcurrent enforcement)
       → agentOutput (Ink TUI)
       → tts (edgeTts → piper → say)
       → worktreeManager (git worktree per operator)
       → memoryStore + autoDream (typed memory, confidence decay, consolidation)
       → checkpoint (session snapshots + fork)
       → hooks (pre/post lifecycle events)
       → skillLoader (dynamic skill registration)
       → approvalGates (safety gates, per-operator throttling)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point (commander), fail-fast SDK validation |
| `src/mcpServer.ts` | MCP server — Drive tools exposed to Claude Code, maxConcurrent enforcement |
| `src/operatorManager.ts` | Wraps Agent SDK `query()` per operator with AbortController |
| `src/operatorRegistry.ts` | Operator lifecycle (spawn/switch/dismiss/merge), abort on dismiss |
| `src/driveMode.ts` | State machine (active + subMode) |
| `src/router.ts` | Routes input to correct operator |
| `src/agentOutput.ts` | Terminal output renderer (Ink/React) |
| `src/tts.ts` | TTS dispatch (edgeTts/piper/say backends) |
| `src/atomicWrite.ts` | Shared atomic write utility (tmp + rename pattern) |
| `src/memoryStore.ts` | Typed memory entries with confidence decay |
| `src/memoryManager.ts` | Memory retrieval and contextual search |
| `src/autoDream.ts` | Automatic memory consolidation during idle |
| `src/checkpoint.ts` | Session state snapshots and fork support |
| `src/hooks.ts` | Pre/post lifecycle hooks for operator events |
| `src/skillLoader.ts` | Dynamic skill loading and registration |
| `src/approvalGates.ts` | Safety gates with per-operator throttling |
| `src/approvalQueue.ts` | Approval queue for dangerous operations |
| `src/sessionManager.ts` | Session lifecycle |
| `src/sessionStore.ts` | Session persistence with atomic writes |
| `src/worktreeManager.ts` | Git worktree isolation per operator |
| `src/store.ts` | JSON KV store (state persistence, atomic writes) |
| `src/config.ts` | Config loader (`~/.claude-drive/config.json`), atomic writes |
| `src/syncTypes.ts` | Shared types kept in sync with cursor-drive |

## Coding Conventions

- ESM modules (`"type": "module"` in package.json)
- TypeScript strict mode
- Relative imports use `.js` extension (even for `.ts` source files)
- Named exports preferred over default exports
- `async/await` over raw Promise chains
- Tests in `tests/` using Jest with `ts-jest` ESM preset
- All persistence uses `atomicWriteJSON()` — never raw `fs.writeFileSync` for JSON state
- SDK versions are pinned to exact versions (not `latest`)

## Config

Config file: `~/.claude-drive/config.json`

```bash
node out/cli.js config set tts.backend edgeTts
node out/cli.js config set tts.enabled true
node out/cli.js config set mcp.port 7891
node out/cli.js config set operators.maxConcurrent 3
```

## Sync with cursor-drive

When `../cursor-drive` changes key business logic, sync these files manually:

- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` — copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` — keep in sync

## Maintainers

- [@hhalperin](https://github.com/hhalperin) — lead
- [@ai-secretagent](https://github.com/ai-secretagent) — co-maintainer

## Cursor Cloud specific instructions

- **Node.js**: v22 is pre-installed; no version manager setup needed.
- **Standard commands**: See the `## Commands` section above — `npm install`, `npm run compile`, `npm test`, `npm start` are all you need.
- **MCP server**: `npm start` (or `node out/cli.js start`) launches the MCP server on port 7891. It requires `npm run compile` first. The server uses SSE; plain JSON-only curl requests will get a "Not Acceptable" error — pass `Accept: application/json, text/event-stream` header when testing with curl.
- **Tests run offline**: All 176 Jest tests are fully mocked — no API keys or external services needed.
- **E2E / `run` command**: `node out/cli.js run "<task>"` requires a valid `ANTHROPIC_API_KEY` env var (it calls the Anthropic API via the Agent SDK). Unit tests do not require this key.
- **Port file**: The server writes `~/.claude-drive/port` on start and deletes it on exit. If a previous server crashed, this stale file may cause `node out/cli.js port` to report an incorrect URL — just delete it and restart.
- **No Docker, no databases**: This is a pure Node.js project with no external service dependencies for dev/test.
