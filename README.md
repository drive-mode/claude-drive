# claude-drive

**Voice-first multi-operator pair programming for Claude Code CLI**

[![npm version](https://img.shields.io/npm/v/claude-drive)](https://www.npmjs.com/package/claude-drive)
[![CI](https://github.com/drive-mode/claude-drive/actions/workflows/ci.yml/badge.svg)](https://github.com/drive-mode/claude-drive/actions)

---

## What it does

Claude Drive brings multi-operator pair programming to the Claude Code CLI. Instead of a single AI session, you coordinate a named pool of operators — implementers, reviewers, testers, researchers, and planners — each with scoped permissions and a dedicated role.

Operators communicate through a local MCP server on `:7891`, which acts as the coordination hub: routing commands, managing state, synthesizing speech, and streaming live activity to a terminal agent screen. The whole system runs locally with no cloud backend — your code and context never leave your machine.

Drive mode keeps everyone in sync. Switching sub-modes (`plan`, `agent`, `ask`, `debug`) shifts the active operator and changes the tooling context without interrupting your flow.

---

## Quick Start

### Install

```bash
npm install -g claude-drive
```

### Start the server

```bash
claude-drive start
```

This launches the MCP server on `localhost:7891` and initializes the operator registry.

### Add to Claude Code

Add the MCP server to `~/.claude/settings.json` so Claude Code picks it up automatically:

```json
{
  "mcpServers": {
    "claude-drive": {
      "command": "claude-drive",
      "args": ["start", "--mcp"]
    }
  }
}
```

### Run a session

```bash
# Start Drive with a named operator in agent mode
claude-drive start --operator implementer --mode agent

# In another terminal, check active state
claude-drive status

# Register a reviewer alongside the implementer
claude-drive operator add reviewer --permissions readonly
```

From inside a Claude Code session, operators call MCP tools like `drive_update_agent_screen`, `drive_speak`, and `drive_set_mode` to coordinate in real time.

---

## Features

- **Multi-operator registry** — spawn, switch, and dismiss named operators (`implementer`, `reviewer`, `tester`, `researcher`, `planner`) within a single session
- **MCP bridge** — 14 MCP tools exposed on `localhost:7891`; the only coordination channel between Claude Code and Drive state — no sidecar processes or cloud calls
- **TTS speech synthesis** — edge-tts → piper → say fallback chain; operators can speak status updates and decisions aloud
- **Permission presets** — `readonly` (Read/Glob/Grep/WebSearch/WebFetch), `standard` (+ Edit/Write/Bash/Agent), `full` — scoped per operator role
- **Drive sub-modes** — `plan`, `agent`, `ask`, `debug`, `off` — shift context and active tooling without restarting
- **Terminal agent screen** — live ANSI output showing operator activity feed, files touched, and decisions made (Ink TUI planned)
- **Config layering** — CLI flags > env vars > `~/.claude-drive/config.json` > defaults
- **Local-first, privacy-strict** — no telemetry, no cloud state; everything runs on your machine

---

## Architecture

```mermaid
flowchart TD
    A([Voice / Text Input]) --> B[cli.ts]
    B --> C[Router\nintent classification]
    C --> D[Drive Mode\nplan | agent | ask | debug]
    D --> E[Operator Registry\nimplementer · reviewer · tester · researcher · planner]
    E --> F[MCP Server\nlocalhost:7891\n14 tools]
    F --> G[Terminal Agent Screen\nANSI output]
    F --> H[TTS Engine\nedge-tts → piper → say]
    F --> I[Store / State\n~/.claude-drive/]
    J([Claude Code CLI]) -- MCP tool calls --> F
```

### Request pipeline

```
Voice/Text Input
  → fillerCleaner → sanitizer → glossaryExpander
  → router (intent classification)
  → operator (Claude Code with MCP tools)
  → mcpServer (state updates, TTS, Agent Screen)
  → terminal output + speech
```

---

## Commands

| Command | Description |
|---|---|
| `claude-drive start` | Start the MCP server and initialize the operator registry |
| `claude-drive start --mcp` | Start in MCP stdio mode (used by Claude Code integration) |
| `claude-drive status` | Show current Drive mode, active operator, and server health |
| `claude-drive operator add <role>` | Register a new operator with an optional `--permissions` preset |
| `claude-drive operator list` | List all registered operators and their states |
| `claude-drive operator switch <name>` | Make a named operator active |
| `claude-drive operator dismiss <name>` | Remove an operator from the registry |
| `claude-drive mode <submode>` | Set Drive sub-mode (`plan`, `agent`, `ask`, `debug`, `off`) |
| `claude-drive config` | Print the resolved configuration |

---

## Documentation

- [Architecture](docs/architecture.md)
- [Operators](docs/operators.md)
- [MCP Tools Reference](docs/mcp-tools.md)
- [CLI Reference](docs/cli-reference.md)
- [Configuration](docs/configuration.md)
- [TTS Setup](docs/tts-setup.md)
- [Claude Code Integration](docs/claude-code-integration.md)
- [Agent Screen](docs/agent-screen.md)
- [Contributing](CONTRIBUTING.md)

---

## License

MIT
