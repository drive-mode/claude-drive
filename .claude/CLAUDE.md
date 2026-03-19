# claude-drive Project Instructions

## What This Is

**claude-drive** is a CLI daemon + MCP server that brings voice-first, multi-operator AI pair programming to Claude Code CLI. It mirrors cursor-drive but has no VS Code dependency — it runs as a standalone Node.js process.

## Commands

```bash
npm run compile     # TypeScript compilation (tsc -p ./)
npm run watch       # Watch mode
npm test            # Jest unit tests
```

Start the server:
```bash
node out/cli.js start          # default port 7891
node out/cli.js start -p 7892  # custom port
node out/cli.js port           # print live MCP URL (reads ~/.claude-drive/port)
```

## Architecture

- **`src/cli.ts`** — Commander CLI entry point. Subcommands: `start`, `run`, `operator`, `mode`, `tts`, `config`, `port`.
- **`src/mcpServer.ts`** — HTTP MCP server. Binds to configured port, tries up to `mcp.portRange` consecutive ports on failure. Writes actual port to `~/.claude-drive/port` on bind; deletes on exit.
- **`src/config.ts`** — Config loader. Priority: runtime flags > env (`CLAUDE_DRIVE_*`) > `~/.claude-drive/config.json` > defaults.
- **`src/operatorRegistry.ts`** — Named operator pool (spawn/switch/dismiss/escalate).
- **`src/driveMode.ts`** — Drive state machine (`active` + `subMode`).
- **`src/tts.ts`** — TTS abstraction over `say.js`, Edge-TTS, Piper.
- **`src/operatorManager.ts`** — Runs operators via Claude Code SDK.
- **`src/worktreeManager.ts`** — Git worktree isolation per operator.
- **`src/sessionManager.ts`** — Save/restore operator sessions.
- **`src/approvalGates.ts`** / **`src/approvalQueue.ts`** — Pre/post scan gates for dangerous operations.

## MCP Tools (when claude-drive is running)

| Tool | Purpose |
|------|---------|
| `operator_spawn` | Spawn a named operator |
| `operator_switch` | Switch foreground operator |
| `operator_dismiss` | Remove an operator |
| `operator_list` | List all active operators |
| `operator_update_task` | Update operator's current task |
| `drive_run_task` | Dispatch a task to an operator |
| `drive_get_state` | Full Drive state snapshot |
| `drive_set_mode` | Set sub-mode (plan/agent/ask/debug/off) |
| `agent_screen_activity` | Log activity message |
| `agent_screen_decision` | Log a decision |
| `tts_speak` | Speak text via TTS |
| `worktree_create` | Allocate git worktree for operator |
| `worktree_merge` | Merge operator branch |
| `session_save` | Save current session |
| `session_restore` | Restore saved session |

## Key Conventions

- ESM TypeScript: use `.js` extensions on all relative imports.
- Named exports only — no default exports in `src/`.
- `getConfig<T>(key)` for all config access; `saveConfig(key, value)` to persist.
- State directory: `~/.claude-drive/` (config, port file, sessions).
- Port file: `~/.claude-drive/port` — plain text, actual bound port number. Created on start, deleted on exit.

## ESM Import Example

```typescript
import { getConfig } from "./config.js";   // ✓ .js extension required
import { getConfig } from "./config";       // ✗ will break at runtime
```
