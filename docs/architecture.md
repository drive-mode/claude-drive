# Architecture

## Overview

Claude Drive is a local CLI daemon that gives Claude Code agents a structured runtime for multi-operator AI pair programming. It exposes an MCP server on `:7891` that Claude Code calls to manage named operators, coordinate state, and speak via TTS — all without any cloud backend or VS Code dependency.

## Module Dependency Graph

```mermaid
graph LR
    cli --> mcpServer
    cli --> operatorRegistry
    cli --> driveMode
    cli --> config

    mcpServer --> operatorRegistry
    mcpServer --> agentOutput
    mcpServer --> tts
    mcpServer --> driveMode

    operatorRegistry --> operatorManager
    operatorRegistry --> store

    operatorManager --> agentOutput
    operatorManager --> config

    driveMode --> store

    tts --> edgeTts
    tts --> piper
    tts --> config

    config --> store

    agentOutput --> syncTypes

    %% External dependencies (dashed)
    cli -.-> commander
    mcpServer -.-> mcp_sdk["@modelcontextprotocol/sdk"]
    operatorManager -.-> agent_sdk["@anthropic-ai/claude-agent-sdk"]
    operatorManager -.-> zod
    config -.-> zod
    edgeTts -.-> edge_tts_universal["edge-tts-universal"]
    tts -.-> say

    style commander fill:#f5f5f5,stroke:#999,stroke-dasharray:4
    style mcp_sdk fill:#f5f5f5,stroke:#999,stroke-dasharray:4
    style agent_sdk fill:#f5f5f5,stroke:#999,stroke-dasharray:4
    style zod fill:#f5f5f5,stroke:#999,stroke-dasharray:4
    style edge_tts_universal fill:#f5f5f5,stroke:#999,stroke-dasharray:4
    style say fill:#f5f5f5,stroke:#999,stroke-dasharray:4
```

## Component Descriptions

| Module | Purpose |
|--------|---------|
| `cli.ts` | Commander CLI entry point; registers all commands (`start`, `run`, `status`, etc.); creates shared `operatorRegistry` and `driveMode` instances |
| `mcpServer.ts` | HTTP MCP server on `:7891`; exposes 14 tools via `@modelcontextprotocol/sdk`; manages sessions via an in-memory `Map` |
| `operatorManager.ts` | Agent SDK wrapper; `runOperator()` calls `query()` from `@anthropic-ai/claude-agent-sdk`; builds system prompts, tool lists, subagent definitions, and `PostToolUse` hooks |
| `operatorRegistry.ts` | In-memory operator pool; lifecycle methods: `spawn`, `switch`, `dismiss`, `pause`, `resume`, `merge`, `delegate`, `escalate`; `minPreset()` for permission inheritance |
| `driveMode.ts` | State machine tracking `active: boolean` and `subMode: DriveSubMode` (`plan | agent | ask | debug`); persists via `store.ts`; fires change events via Node `EventEmitter` |
| `agentOutput.ts` | Terminal ANSI renderer; `AgentOutputEmitter extends EventEmitter`; color-codes output per operator; optionally broadcasts SSE on `:7892` |
| `config.ts` | Layered config loader: CLI flags > `CLAUDE_DRIVE_*` env vars > `~/.claude-drive/config.json` > defaults; exports `getConfig()`, `saveConfig()`, `setFlag()` |
| `store.ts` | Lightweight key-value store backed by a JSON file at `~/.claude-drive/store.json`; used for runtime state persistence across restarts |
| `tts.ts` | TTS orchestrator; `speak()` tries Edge TTS → Piper → `say` fallback in order; reads backend preference from config |
| `edgeTts.ts` | Edge TTS backend using the `edge-tts-universal` package for cloud-free neural voices |
| `piper.ts` | Piper TTS backend invoking a local Piper binary for fully offline synthesis |
| `router.ts` | Intent router stub; placeholder for future voice command classification and dispatch |
| `syncTypes.ts` | Shared TypeScript types for git worktree sync state; imported by modules that coordinate parallel operator isolation |

## Data Flows

### a. `claude-drive start` flow

```mermaid
sequenceDiagram
    participant User
    participant cli
    participant config
    participant driveMode
    participant operatorRegistry
    participant mcpServer

    User->>cli: claude-drive start
    cli->>config: getConfig()
    config-->>cli: resolved config
    cli->>driveMode: new DriveMode(store)
    cli->>operatorRegistry: new OperatorRegistry()
    cli->>mcpServer: lazy import + startServer(:7891)
    mcpServer-->>cli: listening
    cli-->>User: Drive started on :7891
```

### b. `claude-drive run "task"` flow

```mermaid
sequenceDiagram
    participant User
    participant cli
    participant operatorRegistry
    participant operatorManager
    participant agentOutput
    participant AgentSDK as "@anthropic-ai/claude-agent-sdk"

    User->>cli: claude-drive run "task"
    cli->>operatorRegistry: spawn(operatorDef)
    operatorRegistry->>operatorManager: runOperator(operator, task)
    operatorManager->>operatorManager: build system prompt + tool list
    operatorManager->>AgentSDK: query(messages, tools, subagents)
    AgentSDK-->>operatorManager: stream of events + tool calls
    operatorManager->>agentOutput: emit(event) via PostToolUse hooks
    agentOutput-->>User: ANSI-colored terminal output
    AgentSDK-->>operatorManager: final result
    operatorManager-->>operatorRegistry: operator complete
```

### c. Claude Code → MCP tool call flow

```mermaid
sequenceDiagram
    participant ClaudeCode as "Claude Code"
    participant mcpServer
    participant operatorRegistry
    participant agentOutput
    participant tts

    ClaudeCode->>mcpServer: HTTP POST /mcp (tool: drive_update_agent_screen)
    mcpServer->>mcpServer: validate session + parse args (zod)
    mcpServer->>operatorRegistry: getOperator(name)
    operatorRegistry-->>mcpServer: operator instance
    mcpServer->>agentOutput: emit(update)
    agentOutput-->>ClaudeCode: SSE broadcast (optional, :7892)
    mcpServer->>tts: speak(message) [if tool: drive_speak]
    tts-->>mcpServer: audio played
    mcpServer-->>ClaudeCode: MCP tool result
```

### d. Permission cascade on operator spawn

```mermaid
sequenceDiagram
    participant Caller
    participant operatorRegistry
    participant operatorManager

    Caller->>operatorRegistry: spawn(childDef, parentName)
    operatorRegistry->>operatorRegistry: resolve parent operator
    operatorRegistry->>operatorRegistry: child.preset = minPreset(child.preset, parent.preset)
    Note right of operatorRegistry: Child can never exceed<br/>parent's permission level
    operatorRegistry->>operatorManager: runOperator(child, task)
    operatorManager->>operatorManager: build tool list filtered by child.preset
    operatorManager-->>operatorRegistry: operator running
    operatorRegistry-->>Caller: child operator handle
```

## Key Design Decisions

- **Local-first, no cloud state** — all state lives in `~/.claude-drive/` JSON files or in-process memory; no telemetry, no external services required.
- **No VS Code dependency** — claude-drive is a pure Node.js CLI; it complements the cursor-drive VS Code extension but runs independently, making it usable from any terminal or CI environment.
- **MCP bridge as the only integration channel** — Claude Code connects exclusively through the MCP server on `:7891`; this keeps the boundary clean and the protocol standard, avoiding any need to hook into Cursor internals.
- **Agent SDK wrapper pattern** — `operatorManager.ts` wraps `@anthropic-ai/claude-agent-sdk` rather than calling it directly from the registry; this isolates prompt engineering, tool construction, and hook wiring in one place and keeps the registry focused on lifecycle management.
- **Permission inheritance via `minPreset()`** — child operators can never exceed their parent's permission preset; this enforces a least-privilege cascade without requiring explicit deny lists.
- **TTS fallback chain** — `tts.ts` tries Edge TTS → Piper → `say` in order so the system degrades gracefully from high-quality neural voices to the OS default synthesizer without configuration changes.
