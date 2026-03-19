# claude-drive Project Instructions

## What This Is

**claude-drive** is a CLI daemon + MCP server that brings voice-first, multi-operator AI pair programming to Claude Code CLI. It mirrors cursor-drive but has no VS Code dependency -- it runs as a standalone Node.js process.

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
```

## Architecture

- **`src/cli.ts`** -- Commander CLI entry point. Subcommands: `start`, `run`, `operator`, `mode`, `tts`, `config`.
- **`src/mcpServer.ts`** -- HTTP MCP server. Binds to configured port on localhost.
- **`src/config.ts`** -- Config loader. Priority: runtime flags > env (`CLAUDE_DRIVE_*`) > `~/.claude-drive/config.json` > defaults.
- **`src/operatorRegistry.ts`** -- Named operator pool (spawn/switch/dismiss).
- **`src/driveMode.ts`** -- Drive state machine (`active` + `subMode`).
- **`src/tts.ts`** -- TTS abstraction over say.js, Edge-TTS, Piper.
- **`src/edgeTts.ts`** -- Edge TTS backend.
- **`src/piper.ts`** -- Piper TTS backend.
- **`src/operatorManager.ts`** -- Runs operators via Claude Code SDK.
- **`src/agentOutput.ts`** -- Terminal output renderer.
- **`src/router.ts`** -- Task routing logic.
- **`src/store.ts`** -- JSON file KV store (persists state).
- **`src/syncTypes.ts`** -- Shared type definitions (synced from cursor-drive).

## MCP Tools (14 tools)

### Operators

| Tool | Description |
|------|-------------|
| `operator_spawn` | Spawn a new named operator |
| `operator_switch` | Switch to a different operator |
| `operator_dismiss` | Dismiss an operator |
| `operator_list` | List active operators |
| `operator_update_task` | Update an operator's current task |
| `operator_update_memory` | Append a note to operator memory |

### Agent Screen

| Tool | Description |
|------|-------------|
| `agent_screen_activity` | Log an activity message |
| `agent_screen_file` | Log a file touch |
| `agent_screen_decision` | Log a decision |
| `agent_screen_clear` | Clear the agent screen |
| `agent_screen_chime` | Play a chime notification |

### TTS

| Tool | Description |
|------|-------------|
| `tts_speak` | Speak text aloud via TTS |
| `tts_stop` | Stop TTS playback |

### Drive

| Tool | Description |
|------|-------------|
| `drive_set_mode` | Set sub-mode (plan/agent/ask/debug/off) |

## Config Keys

| Key | Default | Description |
|---|---|---|
| `tts.enabled` | `true` | Enable TTS |
| `tts.backend` | `"edgeTts"` | Backend: edgeTts, piper, say |
| `tts.voice` | - | Voice name |
| `tts.speed` | `1.0` | Speed multiplier |
| `tts.volume` | `0.8` | Volume |
| `tts.maxSpokenSentences` | `3` | Max sentences to speak |
| `tts.interruptOnInput` | `true` | Stop TTS on user input |
| `operators.maxConcurrent` | `3` | Max concurrent operators |
| `operators.maxSubagents` | `2` | Max subagents per operator |
| `operators.defaultPermissionPreset` | `"standard"` | Default permission preset |
| `mcp.port` | `7891` | MCP server port |
| `mcp.appsEnabled` | `false` | Enable MCP apps |
| `agentScreen.mode` | `"terminal"` | Output: terminal or web |
| `agentScreen.webPort` | `7892` | Web agent screen port |
| `drive.defaultMode` | `"agent"` | Default drive sub-mode |
| `drive.confirmGates` | `true` | Enable approval gates |
| `voice.enabled` | `false` | Enable voice input |
| `voice.wakeWord` | `"hey drive"` | Voice wake word |
| `privacy.persistTranscripts` | `false` | Save voice transcripts |

## Key Conventions

- ESM TypeScript: use `.js` extensions on all relative imports.
- Named exports only -- no default exports in `src/`.
- `getConfig<T>(key)` for all config access; `saveConfig(key, value)` to persist.
- State directory: `~/.claude-drive/` (config, sessions).
- Env var override: any config key maps to `CLAUDE_DRIVE_<KEY>` (e.g., `tts.backend` -> `CLAUDE_DRIVE_TTS_BACKEND`).

## ESM Import Example

```typescript
import { getConfig } from "./config.js";   // correct -- .js extension required
import { getConfig } from "./config";       // wrong -- will break at runtime
```
