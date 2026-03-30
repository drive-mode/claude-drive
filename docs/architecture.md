# Architecture Guide

This document describes the internal architecture of claude-drive — how the pieces fit together, the key data flows, and the design decisions behind them.

## Overview

claude-drive is a standalone Node.js daemon that acts as a bridge between Claude Code CLI and the multi-operator orchestration system originally built for Cursor IDE. It exposes tools via MCP (Model Context Protocol) that Claude Code calls to spawn operators, run tasks, manage sessions, and more.

Think of it as a "mission control" process: Claude Code talks to it over MCP, it coordinates multiple Claude subagents (operators), each isolated in their own git worktree, with safety gates, TTS narration, and session persistence.

## System Context

```
┌─────────────────┐     MCP (HTTP)      ┌──────────────────┐
│   Claude Code    │ ◄─────────────────► │   claude-drive   │
│   (user's CLI)   │     localhost:7891   │   (daemon)       │
└─────────────────┘                      └────────┬─────────┘
                                                  │
                                    ┌─────────────┼──────────────┐
                                    ▼             ▼              ▼
                              ┌──────────┐ ┌──────────┐ ┌──────────────┐
                              │ Operator │ │ Operator │ │  Operator    │
                              │ "Alpha"  │ │ "Beta"   │ │  "Gamma"     │
                              │ (Agent   │ │ (Agent   │ │  (Agent      │
                              │  SDK)    │ │  SDK)    │ │   SDK)       │
                              └────┬─────┘ └────┬─────┘ └──────┬──────┘
                                   │             │              │
                              ┌────▼─────┐ ┌────▼─────┐ ┌──────▼──────┐
                              │ worktree │ │ worktree │ │  worktree   │
                              │ /drive/  │ │ /drive/  │ │  /drive/    │
                              │ op/aaa   │ │ op/bbb   │ │  op/ccc     │
                              └──────────┘ └──────────┘ └─────────────┘
```

## Module Dependency Graph

```
cli.ts (entry point)
  ├── config.ts ──────────────── config loader
  ├── driveMode.ts ──────────── state machine
  ├── operatorRegistry.ts ───── operator lifecycle
  ├── operatorManager.ts ────── Agent SDK wrapper
  │     ├── agentOutput.ts       (logging)
  │     ├── tts.ts               (narration)
  │     └── config.ts            (port lookup)
  ├── mcpServer.ts ──────────── HTTP + MCP protocol
  │     ├── operatorRegistry.ts
  │     ├── operatorManager.ts
  │     ├── agentOutput.ts
  │     ├── tts.ts
  │     ├── approvalQueue.ts
  │     ├── sessionManager.ts
  │     ├── worktreeManager.ts
  │     └── gitService.ts
  ├── agentOutput.ts ────────── terminal output
  ├── router.ts ─────────────── intent classification
  ├── tts.ts ────────────────── TTS dispatch
  │     ├── edgeTts.ts           (cloud neural TTS)
  │     └── piper.ts             (local neural TTS)
  ├── tui.tsx ───────────────── Ink/React TUI
  └── store.ts ──────────────── JSON KV persistence
```

## Core Subsystems

### 1. CLI Entry Point (`cli.ts`)

The CLI is built with `commander`. It defines subcommands (`start`, `run`, `operator`, `mode`, `tts`, `config`, `port`, `install`) and lazy-imports heavy modules (MCP server, TUI) only when needed to keep startup fast.

Key flow for `start`:
1. Create shared instances: `OperatorRegistry`, `DriveModeManager`
2. Subscribe to registry events for TTS announcements
3. Start MCP server (binds HTTP port, writes port file)
4. Optionally start Ink TUI
5. Wait for SIGINT/SIGTERM, then clean up

### 2. MCP Server (`mcpServer.ts`)

The MCP server is the main interface between Claude Code and claude-drive. It uses `@modelcontextprotocol/sdk` with `StreamableHTTPServerTransport` for per-session connections over HTTP.

Port binding strategy: tries the configured port, then up to `portRange` consecutive ports. On success, writes the actual port to `~/.claude-drive/port`. On exit, deletes the port file.

The server registers 26 tools organized into groups (operator management, agent screen, TTS, drive mode, task execution, approvals, worktrees, sessions). Each tool handler receives Zod-validated input and returns JSON results.

### 3. Operator Registry (`operatorRegistry.ts`)

The registry is the central state manager for operators. It tracks all operators in a Map keyed by ID, emits events on changes, and enforces constraints like max concurrent operators and permission inheritance.

Operator lifecycle: `spawn → active → background/paused → completed/merged`

Each operator has a `PermissionPreset` (`readonly`, `standard`, `full`) that controls which Claude Code tools it can use. Child operators (created via `delegate`) are constrained to at most the parent's permission level.

Roles (`implementer`, `reviewer`, `tester`, `researcher`, `planner`) map to default presets and system hints that shape operator behavior.

### 4. Operator Manager (`operatorManager.ts`)

Wraps the Claude Agent SDK's `query()` function. For each operator, it builds a system prompt incorporating the operator's role, memory, and Drive tool hints, then runs a conversation turn. It hooks into Edit/Write/Bash tool calls to log activity to the agent screen.

### 5. Drive Mode (`driveMode.ts`)

A simple state machine with two dimensions: `active` (boolean) and `subMode` (plan | agent | ask | debug | off). Changes are persisted to `store.ts` and broadcast via EventEmitter.

The `router.ts` module classifies user input into the appropriate mode by matching keywords and explicit commands.

### 6. Approval Gates (`approvalGates.ts` + `approvalQueue.ts`)

A safety layer that scans operator commands against configurable regex patterns before execution.

Three tiers: `block` (e.g., `rm -rf /`), `warn` (e.g., `git push --force`), `log` (e.g., `npm publish`). Blocked commands require explicit user approval via the approval queue, which uses a promise-based request/response pattern with 30-second auto-deny timeout.

Per-operator throttling kicks in after 3 blocks or 5 warnings in a session.

### 7. Git Worktree Manager (`worktreeManager.ts` + `gitService.ts`)

Each operator can be isolated in its own git worktree. The `WorktreeManager` creates a branch (`drive/op/<id>`) and worktree directory, then tracks the allocation. When the operator finishes, the worktree can be merged back to the base branch and cleaned up.

Operations are serialized via a promise-chain mutex to avoid concurrent git conflicts.

`GitService` is a typed wrapper around `child_process.execFile` for all git commands, with dependency-injectable exec for testing.

### 8. TTS (`tts.ts`, `edgeTts.ts`, `piper.ts`)

Three backends in fallback order:

1. **edgeTts** — Cloud-based Microsoft Edge neural TTS via `edge-tts-universal`. Synthesizes to MP3, plays with platform-specific player (afplay/aplay/PowerShell).
2. **piper** — Local neural TTS. Requires downloading the piper binary and a voice model. Spawns a process, pipes text to stdin.
3. **say** — System TTS (macOS `say`, or platform equivalent via the `say` npm package).

Sentences are truncated to `maxSpokenSentences` (default 3) to keep narration snappy.

### 9. Session Management (`sessionManager.ts` + `sessionStore.ts`)

Sessions capture a snapshot of the full Drive state: active operators, drive mode, and activity log. Snapshots are serialized to `~/.claude-drive/sessions/<id>.json`.

Restore re-spawns operators from the snapshot, skipping any that fail.

### 10. Agent Output (`agentOutput.ts` + `tui.tsx`)

`AgentOutputEmitter` is a singleton EventEmitter that dispatches structured events (activity, file, decision, chime, clear). In plain terminal mode, it renders colored output to stderr. In TUI mode, the Ink/React components subscribe to events and render a two-pane layout.

## Data Flow: Running a Task

```
1. Claude Code calls `drive_run_task` via MCP
2. mcpServer validates input, checks approval gates
3. operatorRegistry.spawn() creates operator context
4. worktreeManager.allocate() creates git branch + worktree
5. operatorManager.runOperator() calls Agent SDK query()
6. Agent SDK executes tools → hooks log to agentOutput
7. agentOutput emits events → terminal/TUI renders
8. tts.speak() narrates key decisions
9. On completion, operator is marked completed
10. worktreeManager.merge() integrates changes
```

## State & Persistence

| Store | Location | Purpose |
|-------|----------|---------|
| Config | `~/.claude-drive/config.json` | User preferences |
| State | `~/.claude-drive/state.json` | Drive mode, runtime KV |
| Sessions | `~/.claude-drive/sessions/*.json` | Operator snapshots |
| Port | `~/.claude-drive/port` | Live server port (ephemeral) |

## Key Design Decisions

**ESM-only**: The project uses native ES modules (`"type": "module"` in package.json) with NodeNext module resolution. All relative imports require `.js` extensions.

**Lazy imports**: Heavy modules (MCP server, TUI, Agent SDK) are imported dynamically in cli.ts to keep `claude-drive --help` fast.

**Event-driven architecture**: The registry, drive mode, approval queue, and agent output all use Node.js EventEmitter for loose coupling between subsystems.

**Permission inheritance**: Child operators can never exceed their parent's permission level. This prevents privilege escalation when operators delegate subtasks.

**Promise-chain mutex**: Git worktree operations are serialized through a promise chain to avoid concurrent conflicts, without the complexity of a full mutex library.

**Fallback chains**: TTS tries multiple backends in order (edgeTts → piper → say). Config loading falls through runtime → env → file → defaults. Port binding tries a range of ports.

## Relationship to cursor-drive

claude-drive is a port of the cursor-drive VS Code extension. ~60% of the source is adapted, with VS Code APIs (ExtensionContext, OutputChannel, TreeView) replaced by Node.js equivalents (fs, EventEmitter, Ink TUI).

Files kept in sync manually: `operatorRegistry.ts`, `router.ts`, `syncTypes.ts`, `tts.ts`, `edgeTts.ts`, `piper.ts`.
