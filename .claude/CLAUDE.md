# claude-drive Project Instructions

## What This Is

**claude-drive** is a CLI daemon + MCP server that brings voice-first, multi-operator AI pair programming to Claude Code CLI. It mirrors cursor-drive but has no VS Code dependency — it runs as a standalone Node.js process.

## Commands

```bash
npm run compile     # TypeScript compilation (tsc -p ./)
npm run watch       # Watch mode
npm test            # Jest unit tests (176 tests across 17 files)
```

Start the server:
```bash
node out/cli.js start          # default port 7891
node out/cli.js start -p 7892  # custom port
node out/cli.js port           # print live MCP URL (reads ~/.claude-drive/port)
```

## Architecture

- **`src/cli.ts`** — Commander CLI entry point. Subcommands: `start`, `run`, `operator`, `mode`, `tts`, `config`, `port`. Includes fail-fast SDK validation at startup.
- **`src/mcpServer.ts`** — HTTP MCP server. Binds to configured port, tries up to `mcp.portRange` consecutive ports on failure. Writes actual port to `~/.claude-drive/port` on bind; deletes on exit. Enforces `operators.maxConcurrent` (default 3).
- **`src/config.ts`** — Config loader. Priority: runtime flags > env (`CLAUDE_DRIVE_*`) > `~/.claude-drive/config.json` > defaults. Uses atomic writes.
- **`src/operatorRegistry.ts`** — Named operator pool (spawn/switch/dismiss/escalate). Fires AbortController on dismiss (including cascade to children).
- **`src/operatorManager.ts`** — Runs operators via Claude Code SDK with AbortController for task cancellation.
- **`src/driveMode.ts`** — Drive state machine (`active` + `subMode`).
- **`src/tts.ts`** — TTS abstraction over `say.js`, Edge-TTS, Piper.
- **`src/worktreeManager.ts`** — Git worktree isolation per operator.
- **`src/sessionManager.ts`** / **`src/sessionStore.ts`** — Save/restore operator sessions with atomic writes.
- **`src/approvalGates.ts`** / **`src/approvalQueue.ts`** — Pre/post scan gates for dangerous operations with per-operator throttling (validates operatorId).
- **`src/atomicWrite.ts`** — Shared atomic write utility (tmp + rename pattern) used by store, sessions, checkpoints, config.
- **`src/memoryStore.ts`** / **`src/memoryManager.ts`** — Typed memory entries with confidence decay and contextual retrieval.
- **`src/autoDream.ts`** — Automatic memory consolidation during idle periods.
- **`src/checkpoint.ts`** — Session state snapshots and fork support.
- **`src/hooks.ts`** — Pre/post lifecycle hooks for operator events.
- **`src/skillLoader.ts`** — Dynamic skill loading and registration.

## MCP Tools (when claude-drive is running)

| Tool | Purpose |
|------|---------|
| `operator_spawn` | Spawn a named operator |
| `operator_switch` | Switch foreground operator |
| `operator_dismiss` | Remove an operator (cancels running tasks) |
| `operator_list` | List all active operators |
| `operator_update_task` | Update operator's current task |
| `drive_run_task` | Dispatch a task to an operator (enforces maxConcurrent) |
| `drive_get_state` | Full Drive state snapshot |
| `drive_set_mode` | Set sub-mode (plan/agent/ask/debug/off) |
| `agent_screen_activity` | Log activity message |
| `agent_screen_decision` | Log a decision |
| `tts_speak` | Speak text via TTS |
| `worktree_create` | Allocate git worktree for operator |
| `worktree_merge` | Merge operator branch |
| `session_save` | Save current session |
| `session_restore` | Restore saved session |
| `memory_*` | Memory CRUD and retrieval |
| `checkpoint_*` | Create/restore/fork session checkpoints |
| `skill_*` | Load and run skills |

## Key Conventions

- ESM TypeScript: use `.js` extensions on all relative imports.
- Named exports only — no default exports in `src/`.
- `getConfig<T>(key)` for all config access; `saveConfig(key, value)` to persist.
- State directory: `~/.claude-drive/` (config, port file, sessions).
- Port file: `~/.claude-drive/port` — plain text, actual bound port number. Created on start, deleted on exit.
- All persistence uses `atomicWriteJSON()` from `src/atomicWrite.ts` — never raw `fs.writeFileSync` for JSON state.
- SDK versions are pinned (not `latest`) — `@anthropic-ai/claude-agent-sdk@0.2.77`, `@anthropic-ai/sdk@0.79.0`.

## ESM Import Example

```typescript
import { getConfig } from "./config.js";   // ✓ .js extension required
import { getConfig } from "./config";       // ✗ will break at runtime
```
