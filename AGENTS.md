# AGENTS.md — claude-drive

AI agent context for working in this repository.

## What This Project Is

**claude-drive** is a standalone Node.js/TypeScript CLI that brings cursor-drive's multi-operator pair programming to the Claude Code CLI. It runs an MCP server on `:7891` that Claude Code reads tools from, and uses `@anthropic-ai/claude-agent-sdk@0.2.111` to execute operators as subagents.

Ported from `../cursor-drive` (VS Code extension). ~60% of source adapted with VS Code APIs replaced by Node.js equivalents.

## Commands

```bash
npm install          # Install dependencies
npm run compile      # TypeScript → out/
npm run watch        # Watch mode
npm run lint         # tsc --noEmit --noUnusedLocals --noUnusedParameters
npm test             # Jest unit tests (272 tests, --experimental-vm-modules)
npm run test:coverage # Coverage reports under /opt/cursor/artifacts/coverage
npm start            # node out/cli.js start
```

## Engineering conventions

See `docs/PRINCIPLES.md` for the full set. The short version:

- Every path goes through `src/paths.ts` (honours `CLAUDE_DRIVE_HOME`).
- Library code logs via `src/logger.ts`, never `console.*`. stdout is reserved
  for CLI user-facing output and `--json` payloads.
- No module-scope mutable `let`. Encapsulate state in a class with
  `__resetForTests()` hooks.
- Config values are zod-validated at load (`src/configSchema.ts`).
- Prefer discriminated unions + control-flow narrowing over `as unknown` casts.
- SDK mocks use `tests/_helpers/sdkMock.ts` (`installSdkMock`, `typicalRun`).

One-shot task:

```bash
node out/cli.js run "add a readme"
```

## Architecture

```
cli.ts (fail-fast SDK validation, registers built-in agents)
 → driveMode + operatorRegistry
     - foreground/background executionMode, nesting, getTree/getChildren
     - contextUsage + runPromise snapshotting
     - AbortController on dismiss
 → operatorManager
     - ensureStartup() SDK pre-warm (0.2.89+ public in 0.2.111)
     - buildQueryOptions() merges taskBudget / effort / agentProgressSummaries
     - handles task_started / task_progress / memory_recall / status events
 → agentDefinitionLoader + builtinAgents
     - .md frontmatter agents from builtin / user / project scopes
 → bestOfN (parallel N-way runs, pluggable scorer)
 → progressFile (~/.claude-drive/subagents/<id>/)
 → mcpServer (localhost:7891, maxConcurrent enforcement)
 → agentOutput (Ink TUI, now with ProgressEvent)
 → tts (edgeTts → piper → say)
 → worktreeManager (git worktree per operator)
 → memoryStore + autoDream + SDK memory_recall import
 → checkpoint (session snapshots + fork)
 → hooks (pre/post lifecycle events)
 → skillLoader (dynamic skill registration)
 → approvalGates (safety gates, per-operator throttling)
 → frontmatter (shared YAML parser for skills + agent defs)
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
| `src/frontmatter.ts` | Shared YAML frontmatter parser (skills + agent defs) |
| `src/agentDefinitionLoader.ts` | Agent definition loader — builtin / user / project scopes |
| `src/builtinAgents.ts` | Built-in agent definitions (`explore`, `bash`, `reviewer`) |
| `src/bestOfN.ts` | Parallel best-of-N runs with pluggable scorer |
| `src/progressFile.ts` | Append-only background progress log + atomic `last.json` |

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

# Phase 2/3 keys
node out/cli.js config set operator.preWarm true              # SDK startup() pre-warm
node out/cli.js config set operator.taskBudget 20000          # token budget (passthrough)
node out/cli.js config set operator.defaultEffort medium      # low|medium|high|xhigh|max
node out/cli.js config set operator.agentProgressSummaries true
node out/cli.js config set operators.maxDepth 3               # nesting clamp
node out/cli.js config set bestOfN.maxCount 4
node out/cli.js config set memory.syncFromSdk true            # import SDK memory_recall
node out/cli.js config set agents.directory "~/.claude-drive/agents"
```

## New CLI commands

```bash
node out/cli.js agent list              # list builtin + user + project agent defs
node out/cli.js agent show <name>       # print resolved JSON for one agent
```

## New MCP tools

`operator_get_progress`, `operator_await`, `operator_context_usage`,
`operator_tree`, `agent_list`, `agent_inspect`, `drive_best_of_n`.

`drive_run_task` now also accepts `background`, `taskBudget`, `effort`, `parentId`, and `agent`.

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
- **Tests run offline**: All 272 Jest tests are fully mocked — no API keys or external services needed.
- **E2E / `run` command**: `node out/cli.js run "<task>"` requires a valid `ANTHROPIC_API_KEY` env var (it calls the Anthropic API via the Agent SDK). Unit tests do not require this key.
- **Port file**: The server writes `~/.claude-drive/port` on start and deletes it on exit. If a previous server crashed, this stale file may cause `node out/cli.js port` to report an incorrect URL — just delete it and restart.
- **No Docker, no databases**: This is a pure Node.js project with no external service dependencies for dev/test.
