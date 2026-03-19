# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**claude-drive** is a standalone Node.js CLI that brings cursor-drive's multi-operator pair programming to Claude Code CLI. It runs an MCP server on `:7891` that Claude Code reads tools from, and uses `@anthropic-ai/claude-agent-sdk` to execute operators as subagents.

## Commands

```bash
npm install          # Install dependencies
npm run compile      # TypeScript -> out/
npm run watch        # Watch mode
npm start            # Start MCP server (node out/cli.js start)
npm test             # Jest unit tests
```

One-shot task:
```bash
node out/cli.js run "add a readme"
```

### CLI Subcommands

| Command | Description |
|---|---|
| `start` | Start the MCP server daemon (`-p` for custom port) |
| `run <task>` | Run a one-shot task (`--name`, `--role`, `--preset`) |
| `operator spawn [name]` | Spawn a new operator (`--task`, `--role`, `--preset`) |
| `operator list` | List active operators |
| `operator switch <name>` | Switch foreground operator |
| `operator dismiss <name>` | Dismiss an operator |
| `mode set <mode>` | Set drive sub-mode (plan/agent/ask/debug/off) |
| `mode status` | Show current drive state |
| `tts <text>` | Speak text via TTS |
| `config set <key> <value>` | Set a config value |
| `config get <key>` | Get a config value |

## Architecture

```
cli.ts -> driveMode + operatorRegistry
       -> operatorManager (Agent SDK query())
       -> mcpServer (localhost:7891) <- registered in ~/.claude/settings.json
       -> agentOutput (terminal + optional SSE)
       -> tts (edgeTts -> piper -> say)
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

## MCP Tools

| Tool | Category | Description |
|---|---|---|
| `operator_spawn` | Operators | Spawn a new named operator |
| `operator_switch` | Operators | Switch to a different operator |
| `operator_dismiss` | Operators | Dismiss an operator |
| `operator_list` | Operators | List active operators |
| `operator_update_task` | Operators | Update an operator's current task |
| `operator_update_memory` | Operators | Append a note to operator memory |
| `agent_screen_activity` | Agent Screen | Log an activity message |
| `agent_screen_file` | Agent Screen | Log a file touch |
| `agent_screen_decision` | Agent Screen | Log a decision |
| `agent_screen_clear` | Agent Screen | Clear the agent screen |
| `agent_screen_chime` | Agent Screen | Play a chime notification |
| `tts_speak` | TTS | Speak text aloud via TTS |
| `tts_stop` | TTS | Stop TTS playback |
| `drive_set_mode` | Drive | Set the drive sub-mode |

## Key Files

| File | Purpose |
|---|---|
| `src/cli.ts` | CLI entry point (commander) |
| `src/mcpServer.ts` | MCP server -- Drive tools exposed to Claude Code |
| `src/operatorManager.ts` | Wraps Agent SDK `query()` per operator |
| `src/operatorRegistry.ts` | Operator lifecycle (spawn/switch/dismiss) |
| `src/driveMode.ts` | State machine (active + subMode) |
| `src/agentOutput.ts` | Terminal output renderer |
| `src/tts.ts` | TTS abstraction (edgeTts/piper/say) |
| `src/edgeTts.ts` | Edge TTS backend |
| `src/piper.ts` | Piper TTS backend |
| `src/config.ts` | Config loader (`~/.claude-drive/config.json`) |
| `src/store.ts` | JSON file KV store (persists state) |
| `src/router.ts` | Task routing logic |
| `src/syncTypes.ts` | Shared type definitions (synced from cursor-drive) |

## Config

Config file: `~/.claude-drive/config.json`

Priority: CLI flags > env (`CLAUDE_DRIVE_*`) > config file > defaults.

| Key | Default | Description |
|---|---|---|
| `tts.enabled` | `true` | Enable TTS |
| `tts.backend` | `"edgeTts"` | TTS backend: edgeTts, piper, say |
| `tts.voice` | - | TTS voice name |
| `tts.speed` | `1.0` | TTS speed multiplier |
| `tts.volume` | `0.8` | TTS volume |
| `tts.maxSpokenSentences` | `3` | Max sentences to speak |
| `tts.interruptOnInput` | `true` | Stop TTS on user input |
| `tts.piperBinaryPath` | - | Path to piper binary |
| `tts.piperModelPath` | - | Path to piper model |
| `operators.maxConcurrent` | `3` | Max concurrent operators |
| `operators.maxSubagents` | `2` | Max subagents per operator |
| `operators.namePool` | `[Alpha..Foxtrot]` | Operator name pool |
| `operators.defaultPermissionPreset` | `"standard"` | Default permission preset |
| `mcp.port` | `7891` | MCP server port |
| `mcp.appsEnabled` | `false` | Enable MCP apps |
| `agentScreen.mode` | `"terminal"` | Output mode: terminal or web |
| `agentScreen.webPort` | `7892` | Web agent screen port |
| `drive.defaultMode` | `"agent"` | Default drive sub-mode |
| `drive.confirmGates` | `true` | Enable approval gates |
| `voice.enabled` | `false` | Enable voice input |
| `voice.wakeWord` | `"hey drive"` | Voice wake word |
| `voice.sleepWord` | `"go to sleep"` | Voice sleep word |
| `voice.whisperPath` | - | Path to whisper binary |
| `privacy.persistTranscripts` | `false` | Save voice transcripts |

```bash
node out/cli.js config set tts.backend edgeTts
node out/cli.js config set tts.enabled true
node out/cli.js config set mcp.port 7891
```

## Relationship to cursor-drive

This project is a port of `../cursor-drive` (VS Code extension) to standalone CLI. ~60% of source is adapted from cursor-drive with VS Code APIs replaced by Node.js equivalents. When cursor-drive changes key business logic, sync these files manually:
- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` -- copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` -- keep in sync manually
