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
# claude-drive Architecture

## 1. High-Level System Overview

Claude Code connects via MCP. The daemon orchestrates operators through the SDK, with memory, safety, and persistence layers underneath.

```mermaid
graph TB
    CC["Claude Code CLI"] -->|"MCP over HTTP :7891"| MCP["mcpServer.ts<br/>52 MCP tools"]

    MCP --> REG["operatorRegistry.ts<br/>Operator Pool"]
    MCP --> DM["driveMode.ts<br/>State Machine"]
    MCP --> MEM["memoryManager.ts<br/>Memory API"]
    MCP --> AG["approvalGates.ts<br/>Safety Gates"]
    MCP --> WM["worktreeManager.ts<br/>Git Isolation"]
    MCP --> TTS["tts.ts<br/>Voice Output"]
    MCP --> SK["skillLoader.ts<br/>Dynamic Skills"]
    MCP --> CP["checkpoint.ts<br/>Snapshots"]

    REG -->|"spawn/dismiss"| OM["operatorManager.ts<br/>SDK query() loop"]
    OM -->|"AbortController"| SDK["@anthropic-ai/claude-agent-sdk"]
    OM -->|"memory context"| MEM
    OM -->|"lifecycle events"| HK["hooks.ts<br/>Lifecycle Hooks"]

    MEM --> MS["memoryStore.ts<br/>Typed Entries"]
    MS --> AD["autoDream.ts<br/>Consolidation Daemon"]

    subgraph Persistence ["Atomic Persistence Layer"]
        AW["atomicWrite.ts<br/>.tmp + rename"]
        ST["store.ts<br/>KV State"]
        SS["sessionStore.ts"]
        CF["config.ts"]
    end

    MS --> AW
    ST --> AW
    SS --> AW
    CF --> AW
    CP --> AW
```

---

## 2. Startup Sequence

Fail-fast SDK validation, then hooks/skills/auto-dream initialization, then MCP server bind.

```mermaid
sequenceDiagram
    participant User
    participant CLI as cli.ts
    participant SDK as claude-agent-sdk
    participant HK as hooks.ts
    participant SK as skillLoader.ts
    participant AD as autoDream.ts
    participant MCP as mcpServer.ts
    participant FS as ~/.claude-drive/

    User->>CLI: claude-drive start
    CLI->>SDK: import("@anthropic-ai/claude-agent-sdk")
    alt SDK missing
        SDK-->>CLI: ImportError
        CLI->>User: FATAL: SDK not installed (exit 1)
    end

    CLI->>CLI: createDriveModeManager()
    CLI->>HK: loadFromDirectory(~/.claude-drive/hooks/)
    CLI->>SK: loadDefaultSkills()
    CLI->>AD: AutoDreamDaemon.start() [15min interval]
    CLI->>HK: fire("SessionStart")
    CLI->>MCP: startServer(registry, driveMode, port)
    MCP->>MCP: Try ports 7891-7895
    MCP->>FS: Write port to ~/.claude-drive/port
    MCP-->>CLI: Server bound
    CLI->>FS: Write status.json
    CLI->>User: MCP server listening on :7891
```

---

## 3. Operator Lifecycle State Machine

Only ONE operator can be Active (foreground) at a time. Dismiss fires AbortController and cascades to children.

```mermaid
stateDiagram-v2
    [*] --> Spawned: operator_spawn

    Spawned --> Active: switchTo()
    Spawned --> Background: (not foreground)

    Active --> Background: switchTo(other)
    Background --> Active: switchTo(this)

    Active --> Paused: pause()
    Background --> Paused: pause()
    Paused --> Active: resume()
    Paused --> Background: resume()

    Active --> Completed: dismiss() + abort()
    Background --> Completed: dismiss() + abort()
    Paused --> Completed: dismiss()

    Active --> Merged: worktree_merge
    Background --> Merged: worktree_merge

    Completed --> [*]
    Merged --> [*]
```

---

## 4. Task Dispatch Flow

MaxConcurrent check, AbortController setup, memory context injection, SDK query loop with cost extraction.

```mermaid
flowchart TD
    A["MCP tool: drive_run_task<br/>(task, operatorName, role, preset)"] --> B{"activeCount >= maxConcurrent?"}
    B -->|Yes| ERR["Return error:<br/>'Cannot dispatch: N active (max 3)'"]
    B -->|No| C["Find or spawn operator"]

    C --> D["runOperator(op, task, opts)"]
    D --> E["Create AbortController<br/>op.abortController = controller"]
    D --> F["buildMemoryContext(opId)<br/>Top 15 entries by priority"]
    D --> G["buildOperatorSystemPrompt()<br/>role + memory + permissions"]

    E --> H
    F --> H
    G --> H["SDK query(prompt, tools, system, agents)"]

    H --> I{"for await msg of query"}

    I -->|"result"| J["Extract costs:<br/>total_cost_usd, duration_ms, num_turns"]
    I -->|"rate_limit"| K["Log rate limit event"]
    I -->|loop| L{"signal.aborted?"}

    L -->|Yes| M["Log 'Task cancelled'<br/>break loop"]
    L -->|No| I

    J --> N["Fire TaskComplete hook"]
    N --> O["registry.recordTaskStats()"]
    O --> P["flushStatus() -> status.json"]
```

---

## 5. Memory System & Auto-Dream

Typed entries with confidence decay. Auto-dream consolidates every 15 minutes.

```mermaid
flowchart LR
    subgraph Write ["Write Path"]
        R["remember(opId, kind, content, tags)"] --> MS["memoryStore<br/>~/.claude-drive/memory.json"]
        C["correct(opId, oldId, newContent)"] --> MS
        S["shareMemory(id)"] -->|"remove operatorId<br/>(make global)"| MS
    end

    subgraph Read ["Read Path"]
        RC["recall(opId, query)"] --> Q["query(kinds, tags, search)"]
        Q --> MS
        BC["buildMemoryContext(opId)"] --> MS
        BC -->|"Top 15 entries"| SP["System Prompt Injection"]
    end

    subgraph Dream ["Auto-Dream (every 15min)"]
        AD["AutoDreamDaemon"] --> P1["1. Prune expired +<br/>confidence < 0.2"]
        P1 --> P2["2. Decay: exponential<br/>half-life 168h"]
        P2 --> P3["3. Merge: >70% keyword<br/>overlap -> supersede"]
        P3 --> P4["4. Promote: operator-scoped<br/>seen in 2+ operators -> global"]
    end

    AD --> MS
```

**Memory priority** (for system prompt context): corrections > decisions > facts > preferences > context

---

## 6. Safety & Approval Gates

Pattern-based filtering with per-operator throttling. 3+ blocks or 5+ warnings = operator throttled.

```mermaid
flowchart TD
    A["Tool use (e.g., Bash command)"] --> B["getGateResult(cmdText, opId)"]

    B --> C{"Match block patterns?<br/>rm -rf, format c:, del /f"}
    C -->|Yes| D["action: BLOCK"]

    C -->|No| E{"Match warn patterns?<br/>force push, hard reset, drop db"}
    E -->|Yes| F["action: WARN"]

    E -->|No| G{"Match log patterns?<br/>sudo, npm publish, git push"}
    G -->|Yes| H["action: LOG"]
    G -->|No| I["action: ALLOW"]

    D --> J["approvalQueue.requestApproval()"]
    F --> J

    J --> K{"User responds<br/>within 30s?"}
    K -->|Approved| L["Execute tool"]
    K -->|Denied| M["Abort tool"]
    K -->|Timeout| M

    H --> L
    I --> L

    D --> T["recordAction(opId, 'block')"]
    T --> U{">= 3 blocks OR >= 5 warns?"}
    U -->|Yes| V["Operator THROTTLED<br/>All actions blocked"]
```

---

## 7. Persistence Architecture

Everything goes through `atomicWriteJSON()` — write to `.tmp`, then `rename`. Atomic on POSIX and NTFS.

```mermaid
flowchart TD
    subgraph Writers
        ST["store.ts<br/>drive state"]
        CF["config.ts<br/>user config"]
        SS["sessionStore.ts<br/>session snapshots"]
        CP["checkpoint.ts<br/>checkpoints + forks"]
        MS["memoryStore.ts<br/>memory entries"]
    end

    ST --> AW["atomicWriteJSON(path, data)"]
    CF --> AW
    SS --> AW
    CP --> AW
    MS --> AW

    AW --> T1["1. mkdirSync(dir, recursive)"]
    T1 --> T2["2. writeFileSync(path.tmp, JSON)"]
    T2 --> T3["3. renameSync(path.tmp -> path)"]

    subgraph Disk ["~/.claude-drive/"]
        S1["state.json"]
        S2["config.json"]
        S3["memory.json"]
        S4["sessions/id.json"]
        S5["sessions/id/checkpoints/cpId.json"]
        S6["port"]
        S7["status.json"]
    end

    T3 --> Disk
```

---

## 8. Drive Mode State Machine

Controls behavior mode. Persists to `store.ts`. Fires `ModeChange` hook on transition.

```mermaid
stateDiagram-v2
    [*] --> Off: default

    Off --> Agent: setActive(true)
    Agent --> Off: setActive(false)

    Agent --> Plan: setSubMode("plan")
    Agent --> Ask: setSubMode("ask")
    Agent --> Debug: setSubMode("debug")

    Plan --> Agent: setSubMode("agent")
    Ask --> Agent: setSubMode("agent")
    Debug --> Agent: setSubMode("agent")

    Plan --> Ask: setSubMode("ask")
    Ask --> Debug: setSubMode("debug")
    Debug --> Plan: setSubMode("plan")
```

---

## 9. Hook System

9 lifecycle events, filtered by matcher regex, sorted by priority. Exit code 2 = abort operation.

```mermaid
flowchart LR
    subgraph Events
        E1["SessionStart"]
        E2["OperatorSpawn"]
        E3["TaskStart"]
        E4["PreToolUse"]
        E5["PostToolUse"]
        E6["OperatorDismiss"]
        E7["ModeChange"]
        E8["MemoryWrite"]
        E9["TaskComplete"]
    end

    subgraph HookRegistry
        direction TB
        F["Filter by event + matcher regex"]
        S["Sort by priority (lower = first)"]
        F --> S
    end

    Events --> HookRegistry

    HookRegistry --> Ct{"Hook type?"}
    Ct -->|command| CMD["Execute shell command<br/>Context passed as env vars"]
    Ct -->|prompt| INJ["Inject text into<br/>operator system prompt"]

    CMD --> X{"Exit code?"}
    X -->|0| OK["Continue"]
    X -->|2| ABORT["Abort operation"]
    X -->|other| LOG["Log error, continue"]
```

---

## 10. Worktree Isolation

Each operator gets its own git branch and working directory. Promise-chain mutex serializes git ops.

```mermaid
sequenceDiagram
    participant MCP as MCP Tool
    participant WM as WorktreeManager
    participant Git as Git
    participant REG as OperatorRegistry

    MCP->>WM: allocate(opId, baseRef?)
    WM->>WM: Acquire mutex lock
    WM->>Git: git branch drive/op/opId [baseRef]
    WM->>Git: git worktree add .drive/worktrees/opId/ drive/op/opId
    WM-->>MCP: { worktreePath, branchName }
    MCP->>REG: updateWorkspaceState(opId, { path, branch })

    Note over WM,Git: Operator works in isolated worktree...

    MCP->>WM: release(opId)
    WM->>WM: Acquire mutex lock
    WM->>Git: git worktree remove .drive/worktrees/opId/
    WM->>Git: git branch -D drive/op/opId
```

---

## 11. Full Module Dependency Map

Complete import graph across all 28 TypeScript modules. Purple = shared atomic write layer. Blue = entry point. Green = MCP surface.

```mermaid
graph TD
    CLI["cli.ts<br/>Entry Point"] --> MCP["mcpServer.ts<br/>52 tools, HTTP+Stdio"]
    CLI --> REG["operatorRegistry.ts"]
    CLI --> DM["driveMode.ts"]
    CLI --> HK["hooks.ts"]
    CLI --> SK["skillLoader.ts"]
    CLI --> AD["autoDream.ts"]
    CLI --> CF["config.ts"]

    MCP --> REG
    MCP --> DM
    MCP --> OM["operatorManager.ts"]
    MCP --> MM["memoryManager.ts"]
    MCP --> AG["approvalGates.ts"]
    MCP --> AQ["approvalQueue.ts"]
    MCP --> WM["worktreeManager.ts"]
    MCP --> TTS["tts.ts"]
    MCP --> SK
    MCP --> CP["checkpoint.ts"]
    MCP --> SS["sessionStore.ts"]
    MCP --> CF

    OM --> REG
    OM --> MM
    OM --> HK
    OM --> AO["agentOutput.ts"]
    OM --> CF

    REG --> HK
    DM --> ST["store.ts"]
    DM --> HK

    MM --> MS["memoryStore.ts"]
    AD --> MS
    CP --> MS
    CP --> REG

    AG --> CF

    TTS --> ET["edgeTts.ts"]
    TTS --> PI["piper.ts"]

    WM --> GS["gitService.ts"]

    ST --> AW["atomicWrite.ts"]
    SS --> AW
    CF --> AW
    CP --> AW
    MS --> AW

    style AW fill:#c084fc,stroke:#333,color:#000
    style CLI fill:#60a5fa,stroke:#333,color:#000
    style MCP fill:#34d399,stroke:#333,color:#000
```

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| Single atomic write utility | One pattern, no partial writes anywhere |
| AbortController per operator | Clean cancellation on dismiss, including child cascade |
| Memory confidence decay | Old unused knowledge fades naturally; auto-dream prunes it |
| Per-operator throttling | Prevents runaway operators from bypassing safety gates |
| Fail-fast SDK check | Catches missing dependency at startup, not mid-task |
| maxConcurrent limit | Prevents resource exhaustion from unbounded operator spawning |
| Promise-chain mutex for worktrees | Git operations must be serialized; no file-level locks needed |
| Hook exit code 2 = abort | Convention that lets hooks cancel operations without killing the process |
| Skill files as Markdown + YAML | Human-readable, version-controllable prompt templates |

---

## 12. User Journey Map

The end-to-end experience from install to productive daily use. Satisfaction scores highlight friction points.

```mermaid
journey
    title claude-drive User Journey: Install to Productive Use
    section Installation
      npm install -g claude-drive: 5: User
      claude-drive start: 4: User
      Copy MCP config to settings.json: 3: User
      claude-drive statusline install: 4: User
    section First Session
      Open second terminal, run claude: 5: User
      Claude auto-discovers MCP tools: 5: Claude Code
      Ask Claude to spawn first operator: 5: User
      Operator runs task, TTS narrates: 5: User, claude-drive
      See status line update with costs: 4: User
    section Multi-Operator Workflow
      Spawn architect (planner role): 5: User
      Architect produces plan in worktree: 5: claude-drive
      Spawn builder (implementer role): 5: User
      Builder works in isolated branch: 5: claude-drive
      Spawn reviewer (readonly role): 4: User
      Reviewer flags issues via escalation: 4: claude-drive
      Approve or deny safety-gated commands: 3: User
      Merge builder worktree to main: 5: User
      Dismiss completed operators: 5: User
    section Session Management
      Checkpoint current state: 5: User
      Fork session to try alternative: 4: User
      Restore checkpoint after bad path: 4: User
      Review costs with drive_get_costs: 5: User
    section Daily Productive Use
      Resume saved session next day: 4: User
      Memory recalls prior decisions: 5: claude-drive
      Auto-dream consolidates stale memory: 5: claude-drive
      Custom hooks fire on lifecycle events: 4: claude-drive
      Skills load reusable prompt templates: 5: User
```

---

## 13. User-System Interaction Flow

How user intent flows through Claude Code, MCP, and claude-drive — and how feedback returns through terminal output, status line, TTS, and approval prompts.

```mermaid
sequenceDiagram
    actor User
    participant CC as Claude Code CLI<br/>(Terminal 2)
    participant MCP as MCP Server<br/>(:7891)
    participant REG as Operator Registry
    participant OM as Operator Manager<br/>(SDK query loop)
    participant AG as Approval Gates
    participant SL as Status Line<br/>(status.json)
    participant TTS as TTS Engine
    participant AQ as Approval Queue

    Note over User,CC: User types natural language in Claude Code
    User->>CC: "Spawn an implementer named builder<br/>to add auth middleware"
    CC->>MCP: operator_spawn(name="builder",<br/>role="implementer", task="add auth")
    MCP->>REG: spawn("builder", task, {role, preset})
    REG-->>MCP: OperatorContext {id, name, status}
    MCP-->>CC: "Spawned operator: builder (standard)"
    CC-->>User: Shows spawn confirmation

    User->>CC: "Run the task on builder"
    CC->>MCP: drive_run_task(task="add auth middleware",<br/>operatorName="builder")
    MCP->>MCP: Check activeCount < maxConcurrent
    MCP->>OM: runOperator(op, task)
    OM->>OM: Create AbortController
    OM->>OM: buildMemoryContext(opId)
    OM->>OM: buildOperatorSystemPrompt()
    OM->>TTS: speak("builder starting: add auth middleware")
    TTS-->>User: Audio narration

    loop SDK query() — streaming tool calls
        OM->>OM: SDK processes tool calls
        OM->>MCP: agent_screen_activity("editing routes.ts")
        MCP->>SL: flushStatus() → status.json
        SL-->>User: Status line updates in Claude Code

        Note over OM,AG: Operator attempts: git push --force
        OM->>AG: getGateResult("git push --force", opId)
        AG-->>OM: action: WARN, pattern: "force push"
        OM->>AQ: requestApproval(op, cmd, "warn")
        AQ-->>User: Approval prompt in terminal
        User->>AQ: approve / deny
        AQ-->>OM: approved=true → execute

        OM->>MCP: agent_screen_file("builder",<br/>"src/middleware/auth.ts", "created")
        OM->>MCP: agent_screen_decision("builder",<br/>"Using JWT for stateless auth")
    end

    OM->>OM: Extract result stats (cost, turns, duration)
    OM->>REG: recordTaskStats(op, cost, duration, turns)
    OM->>TTS: speak("builder done.")
    TTS-->>User: Audio: "builder done"
    OM->>SL: flushStatus()
    SL-->>User: Status line: cost updated

    User->>CC: "What did builder do?"
    CC->>MCP: drive_get_state()
    MCP-->>CC: Full state snapshot
    CC-->>User: Summary of operators, costs, pending approvals
```

---

## 14. Multi-Operator Workflow Example

A concrete scenario: architect plans, builder implements, reviewer reviews. Shows timeline, worktree branches, and how operators coordinate via shared memory.

### Timeline View

```mermaid
gantt
    title Multi-Operator Workflow: Feature Implementation
    dateFormat X
    axisFormat %s

    section Setup
    claude-drive start (Terminal 1)         :done, t0, 0, 2
    claude (Terminal 2)                     :done, t1, 2, 4

    section Architect (planner, readonly)
    Spawn architect                         :done, a0, 4, 5
    Create worktree drive/op/architect      :done, a1, 5, 7
    Analyze codebase, produce plan          :active, a2, 7, 20
    Plan checkpoint saved                   :milestone, a3, 20, 20
    Dismiss architect                       :done, a4, 20, 21

    section Builder (implementer, standard)
    Spawn builder                           :done, b0, 20, 21
    Create worktree drive/op/builder        :done, b1, 21, 23
    Implement auth middleware               :active, b2, 23, 45
    Implement route guards                  :active, b3, 45, 60
    Safety gate rm -rf triggered            :crit, b4, 50, 52
    User approves after review              :done, b5, 52, 53
    Write tests                             :active, b6, 60, 70
    Builder checkpoint saved                :milestone, b7, 70, 70

    section Reviewer (reviewer, readonly)
    Spawn reviewer                          :done, r0, 70, 71
    Create worktree drive/op/reviewer       :done, r1, 71, 73
    Review builder changes                  :active, r2, 73, 85
    Escalate missing error handling         :crit, r3, 80, 82
    Report findings via agent_screen        :done, r4, 85, 87
    Dismiss reviewer                        :done, r5, 87, 88

    section Integration
    Builder fixes review findings           :active, i1, 88, 95
    Merge builder worktree to main          :done, i2, 95, 97
    Dismiss builder                         :done, i3, 97, 98
    Final session checkpoint                :milestone, i4, 98, 98
```

### Coordination View

```mermaid
sequenceDiagram
    actor User
    participant CC as Claude Code
    participant Arch as Architect<br/>(planner, readonly)
    participant Build as Builder<br/>(implementer, standard)
    participant Rev as Reviewer<br/>(readonly)
    participant WT as Worktree Manager
    participant Mem as Memory Store

    User->>CC: "Spawn architect to plan auth feature"
    CC->>Arch: operator_spawn(role=planner)
    CC->>WT: worktree_create(architect, HEAD)
    WT-->>Arch: drive/op/architect branch

    Arch->>Arch: Analyze codebase (read-only)
    Arch->>Mem: memory_remember(decision,<br/>"Use JWT with refresh tokens")
    Arch->>Mem: memory_remember(fact,<br/>"Auth routes need /login, /refresh, /logout")
    Arch->>CC: agent_screen_decision("Plan complete:<br/>3 files, 2 new endpoints")

    User->>CC: "Dismiss architect, spawn builder"
    CC->>Arch: operator_dismiss(architect)
    CC->>Build: operator_spawn(role=implementer)
    CC->>WT: worktree_create(builder, HEAD)
    WT-->>Build: drive/op/builder branch

    Note over Build,Mem: Builder inherits shared memories
    Build->>Mem: memory_recall(kinds=[decision, fact])
    Mem-->>Build: "Use JWT...", "Auth routes need..."

    Build->>Build: Implement auth middleware
    Build->>Build: Implement route guards

    Note over Build: Safety gate triggers on dangerous command
    Build-->>User: approval_request(rm -rf node_modules, block)
    User-->>Build: approval_respond(approved=true)

    Build->>Build: Write tests
    User->>CC: "Checkpoint, then spawn reviewer"
    CC->>CC: session_checkpoint("pre-review")

    CC->>Rev: operator_spawn(role=reviewer)
    CC->>WT: worktree_create(reviewer, drive/op/builder)
    Rev->>Rev: Review builder's diff (read-only)
    Rev->>CC: operator_escalate(warning,<br/>"Missing error handling in /refresh")
    Rev->>Mem: memory_remember(correction,<br/>"Must handle expired token edge case")

    User->>CC: "Dismiss reviewer, have builder fix it"
    CC->>Rev: operator_dismiss(reviewer)
    Build->>Mem: memory_recall(kinds=[correction])
    Mem-->>Build: "Must handle expired token..."
    Build->>Build: Fix error handling

    User->>CC: "Merge builder to main"
    CC->>WT: worktree_merge(builder, main)
    CC->>Build: operator_dismiss(builder)
    CC->>CC: session_checkpoint("feature-complete")
```

---

## 15. Session Lifecycle

How session state is preserved, checkpointed, forked, and restored.

### State Machine

```mermaid
stateDiagram-v2
    [*] --> Running: claude-drive start

    state Running {
        [*] --> Active
        Active --> Active: spawn/dismiss operators
        Active --> Active: drive_run_task
        Active --> Active: mode changes

        Active --> Checkpointed: session_checkpoint
        Checkpointed --> Active: continue working
        Checkpointed --> Forked: session_fork
        Checkpointed --> Restored: session_restore

        Restored --> Active: operators re-spawned,<br/>memory imported

        Forked --> Active: new session ID,<br/>independent timeline
    }

    Running --> Saved: session_save
    Saved --> Running: session_restore

    Running --> Shutdown: SIGINT / ctrl-c
    Shutdown --> [*]: cleanup port file,<br/>status file, hooks
```

### Checkpoint Data Flow

```mermaid
flowchart TD
    subgraph Create ["Checkpoint Create"]
        CC1["session_checkpoint(name?)"] --> CC2["Snapshot registry.list()"]
        CC1 --> CC3["Snapshot driveMode state"]
        CC1 --> CC4["exportAll() from memoryStore"]
        CC1 --> CC5["Copy activity log"]
        CC2 --> CC6["atomicWriteJSON(<br/>sessions/id/checkpoints/cpId.json)"]
        CC3 --> CC6
        CC4 --> CC6
        CC5 --> CC6
        CC6 --> CC7{"checkpoints > max (20)?"}
        CC7 -->|Yes| CC8["Prune oldest"]
        CC7 -->|No| CC9["Done"]
    end

    subgraph Restore ["Checkpoint Restore"]
        CR1["session_restore(cpId)"] --> CR2["Find checkpoint"]
        CR2 --> CR3["Dismiss all current operators"]
        CR3 --> CR4["Re-spawn from snapshot"]
        CR4 --> CR5["importBulk(checkpoint.memory)"]
        CR5 --> CR6["Restore driveMode state"]
    end

    subgraph Fork ["Session Fork"]
        SF1["session_fork(cpId?, name?)"] --> SF2{"checkpointId?"}
        SF2 -->|Yes| SF3["Find existing checkpoint"]
        SF2 -->|No| SF4["Create checkpoint now"]
        SF3 --> SF5["Generate new session ID"]
        SF4 --> SF5
        SF5 --> SF6["Clone with new sessionId"]
        SF6 --> SF7["metadata: forkedFrom, timestamp"]
        SF7 --> SF8["Write to new session dir"]
    end
```

---

## 16. Status Line & Feedback Channels

The four channels through which the system communicates back to the user during operation.

```mermaid
flowchart LR
    subgraph System ["claude-drive daemon"]
        OM["operatorManager<br/>SDK query loop"]
        AO["agentOutput<br/>event emitter"]
        SL["statusFile<br/>status.json writer"]
        TTS["tts engine<br/>edgeTts/piper/say"]
        AQ["approvalQueue<br/>pending requests"]
    end

    OM -->|"activity, file,<br/>decision events"| AO
    OM -->|"cost, turns,<br/>operator stats"| SL
    OM -->|"narration text"| TTS
    OM -->|"dangerous cmd<br/>detected"| AQ

    subgraph Feedback ["User Feedback Channels"]
        T["Terminal Output<br/>Color-coded, timestamped<br/>14:32:05 [alice] editing auth.ts"]
        S["Status Line<br/>Drive ● agent  $42.15<br/>▶ alice [active] 28T"]
        V["Voice Narration<br/>Audio: 'alice starting:<br/>add auth middleware'"]
        A["Approval Prompt<br/>[block] rm -rf dist<br/>Approve? (30s timeout)"]
    end

    AO --> T
    SL --> S
    TTS --> V
    AQ --> A

    T -->|"read"| User((User))
    S -->|"glance"| User
    V -->|"listen"| User
    A -->|"respond"| User
```
