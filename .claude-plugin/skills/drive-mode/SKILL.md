---
name: drive-mode
description: >
  This skill should be used when the user wants to "start drive mode", "activate drive",
  "enable multi-operator mode", "steer the agents", "spawn an operator", "switch operators",
  "run a task with an operator", or coordinate multiple AI agents on a codebase.
  Also triggers when user asks to "set mode to plan/agent/ask/debug".
metadata:
  version: "0.1.0"
  requires: claude-drive MCP server running on localhost:7891
---

# Drive Mode

Drive mode gives you a steering wheel for your Claude agents. One foreground operator takes
the wheel; others work in the background. All report progress to the activity feed and speak
updates aloud via TTS.

## Prerequisites

Start the claude-drive daemon before using any drive tools:
```bash
node out/cli.js start          # or: claude-drive start
```

Verify it's running:
```bash
node out/cli.js port           # prints http://localhost:<port>/mcp
```

## Core Workflow

### 1. Spawn operators
Use `operator_spawn` to create named operators with roles:
- `implementer` — writes code
- `reviewer` — audits and critiques
- `tester` — runs and writes tests
- `researcher` — reads/searches, no writes
- `planner` — plans, no writes

### 2. Dispatch tasks
Use `drive_run_task` to send a task to an operator. The operator runs as a full Claude Code
session with the allowed tools for its permission preset.

### 3. Monitor progress
Operators call `agent_screen_activity`, `agent_screen_file`, and `agent_screen_decision`
to stream live updates. Use `drive_get_state` for a full snapshot.

### 4. Switch context
Use `operator_switch` to bring a background operator to the foreground.
Use `operator_dismiss` when an operator's work is complete.

## Sub-modes

| Mode | Purpose |
|------|---------|
| `plan` | Read-only planning — research + decompose |
| `agent` | Full agentic execution |
| `ask` | Clarification loop before acting |
| `debug` | Focused debugging session |
| `off` | Pause drive without dismissing operators |

Set with: `drive_set_mode`

## Permission Presets

| Preset | Tools available |
|--------|----------------|
| `readonly` | Read, Glob, Grep, WebSearch, WebFetch |
| `standard` | + Edit, Write, Bash, Agent |
| `full` | Same as standard (expandable) |
