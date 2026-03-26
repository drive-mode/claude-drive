# 02 — Operator Lifecycle & SDK Integration

> **Auditor:** Claude Opus 4.6 | **Date:** 2026-03-26

---

## Operator State Machine

### Complete Lifecycle

```
spawn()
  ├─ id: operator-{timestamp}-{random}
  ├─ status: "active" (if first) or "background"
  ├─ permissionPreset: resolved via role template or hierarchy
  └─ memory: []
     │
     ├─ switchTo() → "active"/"background"
     │  │
     │  ├─ pause() → "paused"
     │  │  └─ resume() → "background"/"active"
     │  │
     │  ├─ merge(src→tgt) → src:"merged", tgt:"active"
     │  │  └─ tgt.memory += src.memory + src.task
     │  │
     │  └─ dismiss() → "completed"
     │     ├─ Cascade: child operators with status!="completed"/"merged" → "completed"
     │     ├─ Foreground shifts to pickNextForeground()
     │     └─ Events emitted: operatorCompleted, OperatorDismiss hook fired
     │
     └─ Implicit end: record stats via recordTaskStats()
        └─ stats tracked: totalCostUsd, totalDurationMs, totalApiDurationMs, totalTurns, taskCount
```

### Valid Status Values (`operatorRegistry.ts:12`)

| Status | Description | Terminal? |
|--------|-------------|-----------|
| `active` | Foreground operator, receives input focus | No |
| `background` | Backgrounded when another operator becomes active | No |
| `completed` | Terminal state (dismissed) | Yes |
| `merged` | Terminal state (merged into another operator) | Yes |
| `paused` | Suspended but not dismissed; can resume | No |

### Foreground Logic (`operatorRegistry.ts:164-168`)

```typescript
if (!this.foregroundId) {
  this.foregroundId = id;  // First spawn becomes foreground
} else {
  op.status = "background";
}
```

### Cascading Dismiss (`operatorRegistry.ts:246-252`)

When an operator is dismissed, all children with `parentId === op.id` are automatically completed if not already completed/merged.

### Spawn Parameters

**Required:** None — all are optional with sensible defaults.

**Optional** (`operatorRegistry.ts:97-102`):
- `preset?: PermissionPreset` — default: role template or "standard" (depth-based)
- `parentId?: string` — links child operators
- `depth?: number` — default: 0 (root) or parent.depth + 1
- `role?: OperatorRole` — "implementer"|"reviewer"|"tester"|"researcher"|"planner"

### Resources Created/Destroyed Per Transition

| Transition | Resource Created | Resource Destroyed | Notes |
|-----------|-----------------|-------------------|-------|
| spawn() | OperatorContext in registry | None | Registers hooks, emits OperatorSpawn event |
| switchTo() | None (state change) | None | Emits change event |
| pause() | None | None | foregroundId reassigned if paused op was foreground |
| resume() | None | None | Restored to background or active |
| merge(src→tgt) | src memory appended to tgt | None (src marked "merged") | Information-only, no resource cleanup |
| dismiss() | Events emitted | None (context still cached) | Logical deletion; memory stays in registry |
| recordTaskStats() | None | None | Accumulates cost/turn data |

**Note:** Registry keeps all operators (even dismissed/merged) in memory indefinitely. No explicit cleanup of worktrees/branches is triggered by state transitions alone.

---

## Role System

### Role Templates (`operatorRegistry.ts:21-47`)

| Role | Default Preset | System Hint |
|------|---------------|-------------|
| `implementer` | standard | Write production-quality code, follow existing patterns, report files via agent_screen_file |
| `reviewer` | readonly | Analyze code for bugs, risks, quality. Do NOT edit files. Report via agent_screen_decision |
| `tester` | standard | Write test cases, run test suites, verify behavior. Report via agent_screen_activity |
| `researcher` | readonly | Explore codebase, read docs, synthesize findings. Do NOT edit production files |
| `planner` | readonly | Analyze requirements, break tasks into steps, produce plan artifacts. Do NOT implement |

### Permission Presets (`operatorManager.ts:15-25`)

| Preset | Tools |
|--------|-------|
| `readonly` | Read, Glob, Grep, WebSearch, WebFetch |
| `standard` | + Edit, Write, Bash, Agent |
| `full` | Same as standard (currently identical) |

**Hierarchy** (`operatorRegistry.ts:60-64`): Child operators cannot exceed parent's permission level via `minPreset()`.

### Visibility Modes (`operatorRegistry.ts:57`)

```typescript
export type OperatorVisibility = "isolated" | "shared" | "collaborative";
```

**Current state:** Tracked but **not enforced** — visibility is stored as metadata only.

---

## Agent SDK Integration

### Complete Trace: Task Input → Result Extraction

```
1. INPUT LAYER
   └─ op: OperatorContext, task: string, opts: RunOperatorOptions

2. SDK INITIALIZATION (operatorManager.ts:104-111)
   ├─ Lazy import @anthropic-ai/claude-agent-sdk
   └─ If missing: console.error + return (SILENT FAILURE)

3. HOOK EXECUTION (operatorManager.ts:124-129)
   ├─ TaskStart hook fired (non-blocking)
   ├─ If hook.abort=true: logActivity + return (task aborted)
   └─ Hook can mutate input

4. SDK PARAMETERS (operatorManager.ts:113-170)
   └─ queryFn({
       prompt: task,
       options: {
         cwd, allowedTools, agents (subagent defs),
         mcpServers: { "claude-drive": { type: "http", url } },
         systemPrompt: buildOperatorSystemPrompt(op),
         maxTurns: opts.maxTurns ?? 50,
         maxBudgetUsd: getConfig("operator.maxBudgetUsd"),
         hooks: { PostToolUse: [...] }
       }
     })

5. STREAMING LOOP (operatorManager.ts:134-207)
   └─ for await (const msg of queryFn(...)) {
       "system" → extract session_id
       "rate_limit_event" → log warning
       "result" → extract stats, fire TaskComplete hook
     }
```

### All Parameters Passed to query()

| Parameter | Resolution |
|-----------|-----------|
| `prompt` | Direct from task |
| `cwd` | opts.cwd → op.worktreePath → process.cwd() |
| `allowedTools` | toolsForPreset(op.permissionPreset) |
| `agents` | Built from opts.allOperators via buildSubagentDefs() |
| `mcpServers` | claude-drive HTTP endpoint |
| `systemPrompt` | buildOperatorSystemPrompt(op) |
| `maxTurns` | opts.maxTurns ?? 50 |
| `maxBudgetUsd` | getConfig("operator.maxBudgetUsd") |
| `hooks` | PostToolUse matchers for Edit/Write/Bash logging |

### Subagent Definitions (`operatorManager.ts:63-77`)

- One subagent def per active operator (excluding current)
- Each has role-based description, full system prompt, permission-limited tools
- **Rebuilt fresh on every runOperator call** (not cached)

### Cost Extraction (`operatorManager.ts:194-199`)

```typescript
const stats: TaskResultStats = {
  totalCostUsd: resultMsg.total_cost_usd ?? 0,
  durationMs: resultMsg.duration_ms ?? 0,
  apiDurationMs: resultMsg.duration_api_ms ?? 0,
  numTurns: resultMsg.num_turns ?? 0,
};
```

Recorded via `registry.recordTaskStats()` and accumulated into OperatorStats.

### Error Paths

| Error | Behavior | Severity |
|-------|----------|----------|
| SDK import fails | console.error + silent return | **High** — task silently aborted |
| Rate limit | Log warning, no retry | Medium |
| Network failure | Uncaught, bubbles up | Medium |
| MCP server unreachable | SDK fails on first tool call | Medium |

---

## Drive Mode

### SubModes (`driveMode.ts:10`)

| Mode | Description | Router Keywords |
|------|-------------|-----------------|
| `ask` | Pass-through to Claude | Fallback (no keywords match) |
| `agent` | Execute task with full tooling | add, implement, fix, create, write, refactor, run, execute |
| `plan` | Create plan without implementation | plan, clarify, requirements, design, architecture, break down |
| `debug` | Diagnose issues | debug, diagnose, trace, breakpoint, why does, why is |
| `off` | Drive disabled | Not routable |

### Router Precedence (`router.ts:15-63`)

1. **Explicit `/command`** (highest priority)
2. **Current `driveSubMode`** (active mode overrides keywords)
3. **Keyword matching** (substring, case-insensitive — `lower.includes(k)`)
4. **Fallback to "ask"** (lowest priority)

**False positive risk:** "plan" matches "explain", "architecture" matches "architectural".

### Persistence Across Restarts

- `store.update("drive.active", _active)` on setActive()
- `store.update("drive.subMode", _subMode)` on setSubMode()
- Stored in `~/.claude-drive/state.json`
- Explicit "off" mode is **never persisted** — defaults to `drive.defaultMode`

---

## System Prompt Construction (`operatorManager.ts:29-58`)

**Composition Order:**
1. Operator name + session context
2. Role (if assigned)
3. Role-specific systemHint (from ROLE_TEMPLATES)
4. Memory context (up to 15 entries from memoryStore, prioritized by kind)
5. Legacy memory fallback (op.memory string[])
6. MCP tool instructions
7. Permission warning (if readonly)

---

## Composability Assessment

### Could Operators Be Standalone SDK Agents?

| Aspect | Current | Standalone Benefit |
|--------|---------|-------------------|
| Session Reuse | New query() per task | Could persist session_id |
| State Sharing | Via registry + memory store | Private mutable state |
| Delegation | Dynamic subagent defs | Register once, reuse |
| Cost Tracking | Post-result extraction | Native agent tracking |

**Verdict:** Minor improvement, not transformative. Current approach is closer to Unix philosophy (query as pure function).

### Is the Registry Pattern Right?

✅ **Yes:**
- Prevents invalid state transitions
- Enforces permission constraints
- Supports multi-operator coordination
- Clean separation: SDK is stateless, registry owns state

❌ **Friction points:**
- Foreground/background is UI concern, not SDK concern
- Permission hierarchy redundantly enforced at spawn + query time

---

## Windows 11 Compatibility

| Area | Status | Notes |
|------|--------|-------|
| Path separators | ✅ | Uses path.join() everywhere |
| Process spawning | ✅ | TTS has Windows PowerShell paths |
| Shell assumptions | ⚠️ | hooks.ts execSync without shell:true — bash scripts fail on Windows |
| Temp directories | ✅ | Proper temp dir usage |

---

## Gaps & Risks

### Race Conditions

| Scenario | Risk | Severity |
|----------|------|----------|
| Parallel runOperator() on same op | sessionId overwritten | Low |
| Concurrent registry mutations | nameToId map desync | **Medium** |
| Store file writes racing | .tmp file left on Windows | Low |
| Worktree allocation during dismiss | Assume worktree exists | Medium |

### Silent Error Swallowing

| Error | Location | Severity |
|-------|----------|----------|
| SDK import fails | operatorManager.ts:108 | **High** |
| Hook execution fails | hooks.ts:106 | Medium |
| Store file I/O fails | store.ts:31 | Medium |

### Scalability at 5+ Operators

- ✅ Memory: Fine for 5-10 operators (~1-2 MB)
- ⚠️ CPU: getTotalStats polling could optimize from 10+ Hz to 1 Hz
- ❌ Concurrency: `operators.maxConcurrent: 3` config **never checked in code**
- ⚠️ Worktrees: Serial lock is safe but can bottleneck

### Dead Code / Unused Features

| Feature | Location | Status |
|---------|----------|--------|
| `PermissionPreset: "full"` | operatorRegistry.ts:17 | Identical to "standard" |
| `OperatorVisibility` | operatorRegistry.ts:57 | Tracked, never enforced |
| `EscalationEvent` | operatorRegistry.ts:49 | Emitted, never consumed |

---

## Recommendations

### P0: Safety
1. **Add mutex to OperatorRegistry** — Prevent concurrent spawn/dismiss race
2. **Fail fast on SDK import** — Check at startup, not during runOperator

### P1: Correctness
3. **Enforce maxConcurrent config** — Check in drive_run_task before spawning
4. **Document Windows hook behavior** — Note shell requirement

### P2: Cleanup
5. **Remove or implement OperatorVisibility** — Currently dead metadata
6. **Cache subagent defs** — Rebuild on operator state change, not per task

### P3: Performance
7. **Optimize getTotalStats polling** — Reduce from 10+ Hz to 1 Hz
8. **Move memory truncation to memoryStore** — Let store handle size limits

---

## Assessment Matrix

| Criterion | Score | Notes |
|-----------|-------|-------|
| Single Responsibility | 9/10 | Each file has clear purpose |
| Clean Interfaces | 8/10 | Good type safety |
| Fail Fast | 6/10 | SDK import is lazy; silent failure |
| Cross-Platform | 8/10 | Hooks need Windows docs |
| Scalability | 7/10 | OK for 5-10 operators; maxConcurrent unused |
| Concurrency Safety | 6/10 | No mutex on registry |
| Overall Design | 8/10 | Registry pattern is sound |

**Overall Verdict:** The operator system is well-designed at 774 LOC across 4 core files. Registry pattern correctly maps multi-operator coordination onto the SDK's stateless query model. With P0 fixes (mutex + fail-fast SDK check), it would be production-ready for 10+ concurrent operators.
