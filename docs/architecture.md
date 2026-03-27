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
