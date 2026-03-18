# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**claude-drive** is a standalone Node.js CLI that brings cursor-drive's multi-operator pair programming to Claude Code CLI. It runs an MCP server on `:7891` that Claude Code reads tools from, and uses `@anthropic-ai/claude-agent-sdk` to execute operators as subagents.

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
       → operatorManager (Agent SDK query())
       → mcpServer (localhost:7891) ← registered in ~/.claude/settings.json
       → agentOutput (terminal + optional SSE)
       → tts (edgeTts → piper → say)
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
| `src/cli.ts` | CLI entry point (commander) |
| `src/mcpServer.ts` | MCP server — Drive tools exposed to Claude Code |
| `src/operatorManager.ts` | Wraps Agent SDK `query()` per operator |
| `src/operatorRegistry.ts` | Operator lifecycle (spawn/switch/dismiss/merge) |
| `src/driveMode.ts` | State machine (active + subMode) |
| `src/agentOutput.ts` | Terminal output renderer |
| `src/tts.ts` | TTS (edgeTts/piper/say backends) |
| `src/config.ts` | Config loader (`~/.claude-drive/config.json`) |
| `src/store.ts` | JSON file KV store (persists state) |

## Config

Config file: `~/.claude-drive/config.json`

```bash
node out/cli.js config set tts.backend edgeTts
node out/cli.js config set tts.enabled true
node out/cli.js config set mcp.port 7891
```

## Relationship to cursor-drive

This project is a port of `../cursor-drive` (VS Code extension) to standalone CLI. ~60% of source is adapted from cursor-drive with VS Code APIs replaced by Node.js equivalents. When cursor-drive changes key business logic, sync these files manually:
- `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` — copy with minor import fixes
- `tts.ts`, `edgeTts.ts`, `piper.ts` — keep in sync manually
