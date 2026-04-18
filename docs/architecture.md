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
