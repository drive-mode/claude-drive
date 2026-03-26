# 04 — Infrastructure & Safety

> **Auditor:** Claude Opus 4.6 | **Date:** 2026-03-26

---

## Git Worktree System

### Allocation Flow
```
allocate(operatorId, baseRef="HEAD")
  → Fast path: return existing allocation (no lock)
  → Enter serialized lock (promise-chain)
  → gitService.createBranch(drive/op/<operatorId>, baseRef)
  → gitService.worktreeAdd(.drive/worktrees/<operatorId>, branchName)
  → Store in local Map<string, WorktreeAllocation>
  → Release lock
```

**Strengths:**
- Promise-chain lock (`serialized()`) prevents concurrent mutations
- Idempotent double-check inside lock
- Rollback on worktree creation failure (delete branch if add fails)
- Fast read path for already-allocated operators (no lock overhead)

### Critical Issues

1. **Orphan Cleanup is Fragile**
   - No persistence of allocated worktrees (only in-memory Map)
   - If process crashes, all allocation state is lost
   - Orphaned branches/worktrees remain in git forever

2. **Branch Merge Not Integrated**
   - `gitService.mergeNoFf()` exists but not called by WorktreeManager
   - User must manually call `worktree_merge` MCP tool
   - No automatic cleanup on successful merge

3. **No Distributed Lock**
   - Promise-chain lock is per-instance only
   - Two Node processes on same repo can create worktrees simultaneously

4. **Path Injection Risk (Low)**
   - `operatorId` from external input used in path.join()
   - path.join() normalizes `..` traversal, so limited risk
   - No validation that operatorId contains only safe characters

### Branch Naming
```
Pattern: drive/op/<operatorId>
Example: drive/op/operator-1234567-abcd
```

### Conflict Handling
- None. If merge conflicts occur, `git merge --no-ff` fails with error
- User must resolve manually

---

## Sessions System

### Snapshot Schema
```typescript
{
  id: string;                          // session-<timestamp>-<random>
  createdAt: number;
  name?: string;
  driveMode: { active: boolean; subMode: string };
  operators: OperatorContext[];
  activityLog: DriveOutputEvent[];     // Last 200 events
}
```

### Persistence
- **Format:** JSON files in `~/.claude-drive/sessions/<id>.json`
- **Atomic write:** ❌ Direct `fs.writeFileSync()` — **NOT atomic**
- **Max sessions:** No limit enforced

### Survival Across Restart
| Data | Survives? | Notes |
|------|-----------|-------|
| Operators | ✅ Partial | Restored if status ≠ completed/merged |
| Operator memory | ❌ Lost | memory is in-memory only |
| Worktree allocations | ❌ Lost | Must be manually cleaned up |
| Drive mode | ✅ | active + subMode restored |
| Activity log | ✅ Partial | Truncated to 200 events |

### Checkpoints (Enhanced Sessions)

**Schema:**
```typescript
{
  id: string;                   // cp-<timestamp>-<uuid-8>
  sessionId: string;
  name?: string;
  description?: string;
  createdAt: number;
  operators: OperatorContext[];
  driveMode: { active, subMode };
  memory: MemoryEntry[];        // COMPLETE memory state
  activityLog: DriveOutputEvent[];
  metadata: Record<string, unknown>;
}
```

**Storage:** `~/.claude-drive/sessions/<sessionId>/checkpoints/<checkpointId>.json`

**Operations:**
- **Create:** Snapshot + enforce max checkpoints (default 20), auto-prunes oldest
- **Restore:** Dismiss all current operators, spawn from snapshot, import memory
- **Fork:** Create new session with lineage metadata (`forkedFrom` + `forkedCheckpoint`)
- **Prune:** Delete oldest until count ≤ maxCheckpoints

---

## Approval Gates & Queue

### Default Patterns

**BLOCK** (highest severity):
```
rm -rf, del /f /s /q, format c:, rmdir /s
```

**WARN** (medium):
```
revert, undo all, hard reset, reset --hard, force push,
push --force, push -f, delete branch, drop database, drop table
```

**LOG** (informational):
```
sudo, npm publish, git push
```

### Evaluation Order
1. Check enabled flag → 2. BLOCK patterns → 3. WARN patterns → 4. LOG patterns → 5. ALLOW

### Auto-Throttle Thresholds
```
blockCount >= 3  → throttled: true
warnCount >= 5   → throttled: true
```

**Bypass vulnerability:** Empty operatorId bypasses per-operator throttle tracking.

### Queue Flow
```typescript
requestApproval(operatorName, command, severity, pattern)
  → Create promise
  → Store in pending Map
  → Emit "request" event
  → If severity === "block": auto-deny after 30s timeout
  → Returns promise resolved by respondToApproval()
```

### Security Analysis

| Attack Vector | Risk | Notes |
|--------------|------|-------|
| Empty operatorId | Medium | Bypasses auto-throttle |
| Disable via config | Low | User can disable, operator cannot |
| Warn requests hang | Medium | No timeout on warn severity |

---

## Config System

### Priority Chain
```
1. Runtime flags (CLI args)          ← highest
2. Environment (CLAUDE_DRIVE_*)
3. File (~/.claude-drive/config.json)
4. Defaults                          ← lowest
```

### Env Var Mapping
```
tts.backend → CLAUDE_DRIVE_TTS_BACKEND
```

### Dead Config Keys (11 total)
| Key | Reason |
|-----|--------|
| `operators.defaultPermissionPreset` | Never read in spawn logic |
| `drive.confirmGates` | No confirmation flow implemented |
| `mcp.appsEnabled` | Apps feature not implemented |
| `memory.maxPerOperator` | Per-operator limit not enforced |
| `voice.*` (all 4 keys) | Voice module not implemented |
| `privacy.persistTranscripts` | Transcripts not captured |
| `router.llmEnabled` | LLM routing not implemented |
| `skills.enabled` | Skills always enabled |
| `sessions.autoCheckpoint*` | Auto-checkpoint not implemented |
| `dream.maxAgeMs` | Age cutoff calculated differently |
| `hooks.directory` | Hooks loaded from config only |

### Issues
1. **No validation** — any key can be any type
2. **No schema** — getConfig<T>() casts without validation
3. **No hot reload** — config changes require restart

---

## Memory System

### Entry Schema
```typescript
{
  id: string;
  kind: "fact" | "preference" | "correction" | "decision" | "context";
  content: string;
  source: string;
  operatorId?: string;    // undefined = shared/global
  tags: string[];
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  confidence: number;     // 0.0-1.0, decays over time
  supersededBy?: string;
  expiresAt?: number;
}
```

### Persistence
- **Storage:** `~/.claude-drive/memory.json`
- **Atomic write:** ✅ Uses `.tmp` + `renameSync()` pattern
- **Flush:** On every mutation (add, update, remove)

### Confidence Decay Model
```
newConfidence = confidence × 0.5^(ageHours / halfLifeHours)
```
- Default half-life: 168 hours (1 week)
- Minimum confidence: 0.05 (never decays to zero)
- Applied during auto-dream cycle every 15 minutes

### Visibility Rules
- `recall(operatorId)` returns: operator's own entries + shared (no operatorId)
- Superseded entries excluded
- Expired entries excluded (unless includeExpired)

### Auto-Dream Consolidation (every 15 min)
1. **Prune:** Remove expired + low-confidence (< 0.2) entries
2. **Decay:** Apply exponential decay to entries not accessed in >1 hour
3. **Merge:** Find similar entries (keyword overlap ≥ 0.7), keep newer, supersede older
4. **Promote:** Cross-operator patterns (2+ operators) → shared knowledge

---

## Hooks System

### Events (12 lifecycle events)
```
PreToolUse, PostToolUse, SessionStart, SessionStop,
OperatorSpawn, OperatorDismiss, ModeChange,
PreApproval, PostApproval, MemoryWrite,
TaskStart, TaskComplete
```

### Integration Status

| Event | Wired? | Location |
|-------|--------|----------|
| OperatorSpawn | ✅ | operatorRegistry.ts |
| OperatorDismiss | ✅ | operatorRegistry.ts |
| TaskStart | ✅ | operatorManager.ts |
| TaskComplete | ✅ | operatorManager.ts |
| ModeChange | ✅ | driveMode.ts |
| All others | ❌ | Not wired |

### Issues
1. **7 of 12 events never fired** — PreToolUse, PostToolUse, SessionStart, SessionStop, PreApproval, PostApproval, MemoryWrite
2. **Directory loading not wired** — `hooks.directory` config unused, only inline definitions work
3. **Hook abort ignored** — abort result never checked by callers
4. **Command execution is synchronous** — `execSync()` with 10s timeout can stall system

---

## Persistence & Atomic Writes

| File | Purpose | Atomic? |
|------|---------|---------|
| `config.json` | User configuration | ❌ |
| `state.json` | KV store | ❌ |
| `memory.json` | Global memory | ✅ |
| `port` | MCP server port | ❌ |
| `sessions/<id>.json` | Session snapshot | ❌ |
| `sessions/<sid>/checkpoints/<id>.json` | Checkpoint | ❌ |
| `status.json` | Agent status | ✅ |

**Critical:** 5 of 7 file types use non-atomic writes. Crash during write = corruption.

---

## Windows Compatibility

| Area | Status | Notes |
|------|--------|-------|
| Path separators | ✅ | Uses path.join() everywhere |
| Dot-files (.claude-drive) | ✅ | Works (hidden attribute) |
| Path length (260 chars) | ⚠️ | Not checked in worktreeManager |
| Git worktree | ⚠️ | Untested on Windows |
| Hook execution | ⚠️ | Commands must be Windows-compatible |
| TTS spawning | ✅ | PowerShell paths for Windows |

---

## Critical Findings

### 🔴 CRITICAL (Data Loss / Crash Risk)

1. **Non-atomic writes for sessions, checkpoints, config, store**
   - Fix: Use .tmp + renameSync pattern (like memoryStore does)

2. **Operator memory not persisted**
   - OperatorContext.memory is in-memory only, lost on restart
   - Fix: Save to memoryStore on operator update

3. **Worktree allocation state lost on crash**
   - Orphaned branches remain forever
   - Fix: Persist allocations to `.drive/allocations.json`

4. **Approval queue lost on restart**
   - Pending requests disappear
   - Fix: Persist to disk

### 🟠 HIGH (Bypass / Misuse)

5. **Approval gate bypass via empty operatorId** — bypasses auto-throttle
6. **No config validation** — typos go undetected
7. **11 dead config keys** — confusion, maintenance burden
8. **Hooks not fully integrated** — 7 of 12 events never fired

### 🟡 MEDIUM (Windows / Edge Cases)

9. **Windows compatibility untested** for worktree operations
10. **No branch name validation** — special chars in operatorId could break git
11. **Hook abort result ignored** — hooks can't prevent operations
12. **Skills not integrated into MCP** — loaded but never exposed

---

## Recommendations

### Phase 1: Critical Data Safety
1. Convert all writes to atomic (.tmp + rename)
2. Persist operator memory to memoryStore
3. Persist approval queue to disk
4. Persist worktree allocations

### Phase 2: Safety Validation
5. Add config schema validation (zod)
6. Validate operatorId in approval gates
7. Add Windows compatibility testing

### Phase 3: Feature Completion
8. Complete hook integration (all 12 events)
9. Integrate skills into MCP server
10. Implement auto-checkpoint

### Phase 4: Optimization
11. Consolidate file storage into unified atomic FileStore
12. Add distributed file-based lock for worktree operations
13. Improve dream cycle similarity algorithm

---

## Infrastructure Health Summary

| System | Status | Key Issue | Severity |
|--------|--------|-----------|----------|
| Git Worktree | ⚠️ | No allocation persistence | CRITICAL |
| Sessions | ⚠️ | Non-atomic writes | CRITICAL |
| Checkpoints | ⚠️ | Non-atomic writes | CRITICAL |
| Approval Gates | ⚠️ | Empty operatorId bypass | HIGH |
| Approval Queue | ⚠️ | Lost on restart | CRITICAL |
| Config | ✅ | Dead keys, no validation | MEDIUM |
| Memory | ✅ | Per-operator limit unenforced | MEDIUM |
| Hooks | ⚠️ | Not fully integrated | HIGH |
| Skills | ❌ | Not exposed via MCP | HIGH |
| Windows | ❓ | Untested | MEDIUM |
