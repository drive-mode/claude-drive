# CLI Reference

## Overview

`claude-drive` is the command-line interface for Claude Drive, a local MCP server and operator management tool for voice-first, multi-operator AI pair programming. The CLI lets you start the MCP server, spawn and manage named operators, switch drive modes, speak via TTS, and read or write configuration — all from your terminal or from scripts that coordinate with the running extension.

---

## Installation

**Global install (recommended):**

```bash
npm install -g claude-drive
```

**Local dev build (from the repo root):**

```bash
npm install
npm run compile
npm link        # makes `claude-drive` available on your PATH from the local build
```

---

## Global flags

| Flag | Description |
|---|---|
| `--version` | Print the installed version and exit |
| `--help` | Print help text for the current command and exit |

---

## Command reference

### `claude-drive start`

Start the Claude Drive MCP server. Sets `driveMode.active = true`, prints a ready-to-paste `settings.json` snippet for connecting Claude/Cursor to the server, and blocks until `SIGINT` (Ctrl+C).

**Syntax:**

```bash
claude-drive start [options]
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `-p, --port <number>` | number | `7891` | Port the MCP server listens on |

**Example:**

```bash
# Start on the default port
claude-drive start

# Start on a custom port
claude-drive start --port 7892
```

---

### `claude-drive run <task>`

Run a one-shot task with the default operator (or a named one). The operator executes the task and exits when complete; no persistent operator state is kept.

**Syntax:**

```bash
claude-drive run <task> [options]
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `-n, --name <name>` | string | — | Operator name to use for this run |
| `--role <role>` | string | — | Operator role: `implementer`, `reviewer`, `tester`, `researcher`, or `planner` |
| `--preset <preset>` | string | — | Permission preset: `readonly`, `standard`, or `full` |

**Example:**

```bash
# Run a one-shot task with defaults
claude-drive run "add unit tests for src/router.ts"

# Run as a reviewer with readonly permissions
claude-drive run "review the last PR diff" --role reviewer --preset readonly
```

---

### `claude-drive operator spawn [name]`

Spawn a new persistent operator. The operator joins the active pool and remains available for switching and further tasking.

**Syntax:**

```bash
claude-drive operator spawn [name] [options]
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `--task <task>` | string | — | Initial task to assign the operator on spawn |
| `--role <role>` | string | — | Operator role: `implementer`, `reviewer`, `tester`, `researcher`, or `planner` |
| `--preset <preset>` | string | — | Permission preset: `readonly`, `standard`, or `full` |

**Example:**

```bash
# Spawn a named operator with a starting task
claude-drive operator spawn alice --task "refactor src/router.ts" --role implementer --preset standard

# Spawn an operator without an initial task
claude-drive operator spawn bob --role reviewer --preset readonly
```

---

### `claude-drive operator list`

List all currently active operators.

**Syntax:**

```bash
claude-drive operator list
```

**Output format:**

```
  {name}[fg]  {preset}  {status}  {task}
```

`[fg]` appears next to whichever operator is currently in the foreground.

**Example:**

```bash
claude-drive operator list
#   alice[fg]  standard  working   refactor src/router.ts
#   bob        readonly  idle
```

---

### `claude-drive operator switch <name>`

Switch the foreground operator to `<name>`. The previously foregrounded operator moves to the background but remains active.

**Syntax:**

```bash
claude-drive operator switch <name>
```

**Example:**

```bash
claude-drive operator switch bob
```

---

### `claude-drive operator dismiss <name>`

Dismiss an operator, removing them from the active pool.

**Syntax:**

```bash
claude-drive operator dismiss <name>
```

**Example:**

```bash
claude-drive operator dismiss bob
```

---

### `claude-drive mode set <mode>`

Set the current drive sub-mode.

**Syntax:**

```bash
claude-drive mode set <mode>
```

**Values:**

| Value | Description |
|---|---|
| `plan` | Planning mode — operators focus on scoping and design |
| `agent` | Agent mode — autonomous execution |
| `ask` | Ask mode — interactive Q&A with the operator |
| `debug` | Debug mode — diagnostic and inspection focus |
| `off` | Disable drive mode |

**Example:**

```bash
claude-drive mode set agent
claude-drive mode set off
```

---

### `claude-drive mode status`

Show the current drive state, including whether drive mode is active and the current sub-mode.

**Syntax:**

```bash
claude-drive mode status
```

**Example:**

```bash
claude-drive mode status
# active: true
# subMode: agent
```

---

### `claude-drive tts <text>`

Speak `<text>` aloud using the configured TTS backend. See [configuration](./configuration.md) for backend options.

**Syntax:**

```bash
claude-drive tts <text>
```

**Example:**

```bash
claude-drive tts "Refactor complete. All tests passing."
```

---

### `claude-drive config set <key> <value>`

Set a configuration value. String values are stored as-is; values that parse as valid JSON booleans, numbers, or arrays are stored as their native types.

**Syntax:**

```bash
claude-drive config set <key> <value>
```

**Example:**

```bash
# Set a string value
claude-drive config set tts.backend edgeTts

# Set a boolean
claude-drive config set tts.enabled true

# Set a number
claude-drive config set mcp.port 7892

# Set an array (JSON syntax)
claude-drive config set operators.defaultRoles '["implementer","reviewer"]'
```

---

### `claude-drive config get <key>`

Get a configuration value. Output is printed as JSON.

**Syntax:**

```bash
claude-drive config get <key>
```

**Example:**

```bash
claude-drive config get tts.backend
# "edgeTts"

claude-drive config get mcp.port
# 7891
```

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (invalid arguments, server failure, operator not found, etc.) |

---

## Environment

Environment variables override the equivalent config values at runtime without permanently changing your config file.

| Variable | Equivalent config key | Description |
|---|---|---|
| `CLAUDE_DRIVE_MCP_PORT` | `mcp.port` | Override the MCP server port |

**Example:**

```bash
CLAUDE_DRIVE_MCP_PORT=7892 claude-drive start
```

For the full list of available configuration keys and their defaults, see [configuration](./configuration.md).

---

## Session example

The following end-to-end example shows a typical session: starting the server, spawning operators, running a task, listing the pool, and cleaning up.

```bash
# 1. Start the MCP server (leave this running in a dedicated terminal)
claude-drive start --port 7891

# 2. In a second terminal, spawn a primary implementer
claude-drive operator spawn alice --role implementer --preset standard

# 3. Spawn a reviewer in the background
claude-drive operator spawn bob --role reviewer --preset readonly

# 4. Confirm both operators are active
claude-drive operator list
#   alice[fg]  standard  idle
#   bob        readonly  idle

# 5. Switch to agent mode and kick off a task
claude-drive mode set agent
claude-drive run "add integration tests for src/mcpServer.ts" --name alice

# 6. While alice works, check drive state
claude-drive mode status
#   active: true
#   subMode: agent

# 7. Switch foreground to bob for a review pass
claude-drive operator switch bob
claude-drive run "review alice's changes for safety issues" --name bob --preset readonly

# 8. Announce completion via TTS
claude-drive tts "Review complete. No issues found."

# 9. Dismiss both operators
claude-drive operator dismiss bob
claude-drive operator dismiss alice

# 10. Shut down the server
#     (Ctrl+C in the terminal running `claude-drive start`)
```

For more on operators and their roles, see [operators](./operators.md).
