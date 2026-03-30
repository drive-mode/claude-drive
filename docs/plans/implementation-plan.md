# claude-drive Implementation Plan

> 14 improvements across 4 phases, informed by architecture review, security analysis, implementation complexity estimates, and developer experience evaluation.

## Summary

This plan adds Claude Agent SDK-native features (memory tool, prompt caching, hooks, session resume, adaptive thinking) plus targeted architectural improvements (event-sourced sessions, memory compaction, retry/timeout, merge orchestration) to make claude-drive's operators smarter, safer, and more efficient.

**Total estimated effort:** ~73 hours across 4 phases over 6 weeks.

**Key decisions from agent team analysis:**

- **Architect agent:** Event-sourced sessions (item 2) is the foundation — build first. Merge orchestration (item 6) is highest-risk — gate behind approval. Session resume (item 10) needs SDK validation before committing.
- **Security agent:** Three items flagged critical: merge orchestration, CLAUDE.md injection, and PreToolUse hook mutation. All require safeguards before shipping.
- **Implementation agent:** Easiest wins are CLAUDE.md per worktree (3h), Memory Tool (4h), and prompt caching (3h). Hardest are semantic routing (8h), event-sourced sessions (7h), and PreToolUse hooks (6h).
- **DX agent:** Users care most about saving/resuming work, contextual memory, and safety gates. Items that change behavior silently (memory compaction, adaptive thinking, strategy memory) must be opt-in.

---

## Phase 1: Foundation (Week 1-2)

> Goal: Build the infrastructure everything else depends on. Quick wins that are immediately useful.

### 1.1 Event-Sourced Sessions
**Why first:** Foundation for rollback, retry, and session resume. All 4 agents agreed this is the dependency root.

**What changes:**
- `sessionStore.ts` — Replace snapshot-only with append-only event log (`~/.claude-drive/sessions/<id>/events.jsonl`) + periodic snapshots (`~/.claude-drive/sessions/<id>/snapshot.json`)
- `sessionManager.ts` — `trackEvent()` writes to event log instead of in-memory array. Remove 200-entry cap. Add `rollbackTo(eventId)` function.
- New: `SessionEvent` type union (OperatorSpawned, OperatorDismissed, TaskDispatched, ToolExecuted, ModeChanged, ApprovalRequested, etc.)

**Files touched:** `sessionStore.ts`, `sessionManager.ts`, `mcpServer.ts` (session tools)
**Effort:** 7 hours | ~220 new/modified LOC
**Default:** ON — always log events. Snapshots created every 50 events.
**Config keys:** `sessions.eventSourcing: true`, `sessions.snapshotInterval: 50`
**Security:** Append-only at filesystem level. Log entries include timestamp, operator ID, permission level. No deletion API.

### 1.2 CLAUDE.md Per Operator Worktree
**Why now:** Easiest win (3h), immediately improves operator context quality, no breaking changes.

**What changes:**
- `worktreeManager.ts` — After `allocate()`, auto-generate `.claude/CLAUDE.md` in the worktree directory with: operator name, role, task, permission preset, parent project CLAUDE.md reference, and drive tool hints.
- Template is deterministic (same state → same file). Read-only — operators cannot write to it.

**Files touched:** `worktreeManager.ts` (add `generateClaudeMd()` helper)
**Effort:** 3 hours | ~105 LOC
**Default:** ON
**Security mitigation:** CLAUDE.md is system-generated only. Use `realpath()` to prevent path traversal. Operator-written context goes to separate `NOTES.md`.

### 1.3 Prompt Caching
**Why now:** Cheapest improvement (3h), immediate cost reduction, zero breaking changes.

**What changes:**
- `operatorManager.ts` — In `buildOperatorSystemPrompt()`, split the prompt into static (role template, tool hints, permission rules) and dynamic (memory, task) sections. Add `cache_control: { type: "ephemeral" }` marker between them.
- The SDK handles the rest — Anthropic caches the static prefix server-side.

**Files touched:** `operatorManager.ts`
**Effort:** 3 hours | ~95 LOC
**Default:** ON
**Config key:** `agents.promptCaching: true`

### 1.4 Operator Retry + Timeout
**Why now:** Reliability foundation. Currently a stuck operator hangs forever.

**What changes:**
- `operatorManager.ts` — Wrap `runOperator()` with retry logic: max 3 attempts, exponential backoff (1s → 2s → 4s), configurable timeout per attempt. Log each retry to agent screen.
- Re-check approval gates on each retry (permissions may have changed).
- Add `AbortController` timeout on SDK `query()` call.

**Files touched:** `operatorManager.ts`, `config.ts` (new defaults)
**Effort:** 5 hours | ~140 LOC
**Default:** ON (retry), timeout configurable
**Config keys:** `operators.maxRetries: 3`, `operators.retryBackoffMs: 1000`, `operators.timeoutMs: 300000` (5 min)
**DX:** Log retries visibly: `[Alpha] Task failed, retrying (attempt 2/3, backing off 2s)...`

**Phase 1 total: ~18 hours, 4 items**

---

## Phase 2: Safety & SDK Integration (Week 3-4)

> Goal: Replace advisory safety checks with enforced SDK hooks. Add session persistence via SDK session IDs.

### 2.1 PreToolUse Hooks (Replace Regex Gates)
**Why:** Current `approvalGates.ts` is advisory — it returns "block" but doesn't actually block execution. SDK PreToolUse hooks enforce before the tool runs.

**What changes:**
- `operatorManager.ts` — Add `hooks.PreToolUse` to SDK `query()` options alongside existing `PostToolUse`. Hook evaluates against approval gate patterns and returns `allow | deny | ask`.
- `approvalGates.ts` — Refactor `getGateResult()` to return hook-compatible decisions. Keep regex patterns as the matching engine (they work fine — the issue was enforcement, not detection).
- Hook logs original input + decision to event log.
- Hooks are system-defined, immutable, loaded at boot. Operators cannot register hooks.

**Files touched:** `operatorManager.ts`, `approvalGates.ts`, `approvalQueue.ts`
**Effort:** 6 hours | ~180 LOC
**Default:** ON
**Security mitigation:** Hooks do NOT modify tool inputs (security agent flagged mutation as critical risk). They only allow/deny/ask. Approval checks run on original input. All decisions logged.

### 2.2 Session Resume/Fork via SDK Session IDs
**Why:** Currently `resumeSession()` re-spawns operators from scratch. SDK session IDs let you pick up the exact conversation where it left off.

**What changes:**
- `operatorManager.ts` — Store SDK `session_id` from init message (already partially captured). Pass `resume: sessionId` on session restore.
- `sessionManager.ts` — Include SDK session IDs in event log. `resumeSession()` uses `resume` parameter instead of re-spawning.
- New `forkSession()` — Creates a new session branching from an existing one using SDK `fork` parameter.
- `mcpServer.ts` — Add `session_fork` tool.

**Files touched:** `operatorManager.ts`, `sessionManager.ts`, `sessionStore.ts`, `mcpServer.ts`
**Effort:** 6 hours | ~170 LOC
**Default:** ON (resume), fork is explicit
**Config keys:** `sessions.autoSave: true`
**Security:** Session IDs are internal, not exposed via MCP. Resume re-checks current permission level. Fork creates independent context.
**DX:** `claude-drive session save "before-refactor"` → `claude-drive session restore "before-refactor"` → `claude-drive session fork "before-refactor"`

### 2.3 Adaptive Thinking Per Drive Mode
**Why:** Different modes need different reasoning depth. `plan` mode benefits from deep thinking; `agent` mode on simple file reads doesn't.

**What changes:**
- `operatorManager.ts` — In `runOperator()`, set thinking config based on drive sub-mode:
  - `plan` → `thinking: { type: "enabled", budget_tokens: 10000 }`
  - `debug` → `thinking: { type: "enabled", budget_tokens: 8000 }`
  - `agent` → `thinking: { type: "adaptive" }` (model decides)
  - `ask` → `thinking: { type: "adaptive" }`
- `driveMode.ts` — Export mode → thinking config mapping.

**Files touched:** `operatorManager.ts`, `driveMode.ts`, `config.ts`
**Effort:** 4 hours | ~90 LOC
**Default:** OFF (opt-in) — DX agent flagged opaque token spend as confusing
**Config key:** `agents.adaptiveThinking: false`
**DX:** When enabled, log: `[Alpha] Using extended thinking (plan mode, budget: 10000 tokens)`

### 2.4 Parallel Tool Execution
**Why:** Read-only tools (Read, Glob, Grep, WebSearch, WebFetch) can safely run in parallel for ~2x latency improvement on exploration tasks.

**What changes:**
- `operatorManager.ts` — In `toolsForPreset()`, add `readOnlyHint: true` to READONLY_TOOLS. SDK handles parallel dispatch automatically.
- Verify all tools marked read-only are truly side-effect-free.

**Files touched:** `operatorManager.ts`
**Effort:** 3 hours | ~50 LOC (mostly testing)
**Default:** OFF — concurrency needs testing
**Config key:** `agents.parallelTools: false`
**Security:** Cap parallel tool count at 10 per operator. Only read-only tools run in parallel.

**Phase 2 total: ~19 hours, 4 items**

---

## Phase 3: Intelligence Layer (Week 5-6)

> Goal: Make operators smarter about memory, context, and learning.

### 3.1 Memory Compaction (Observation Masking + Summarization)
**Why:** Operators accumulate unbounded context. The 50-entry rolling window drops old memory without summarizing it. This is the biggest quality gap.

**What changes:**
- New: `src/memoryCompactor.ts` — Two strategies:
  1. **Observation masking (zero-cost):** Before persisting to session store, strip large tool outputs (Read results >500 chars, Bash outputs >200 chars) and replace with `[Read src/auth.ts — 342 lines]` stubs. ~40-60% memory reduction.
  2. **Dynamic summarization:** When operator memory exceeds threshold (configurable), call Claude API to summarize oldest half into 5 condensed entries. Retain raw transcript in event log (item 1.1).
- `operatorRegistry.ts` — Replace hardcoded `50` cap with configurable threshold. Call compactor when limit approaches.
- `operatorManager.ts` — Hook into PostToolUse to apply observation masking.

**Files touched:** New `memoryCompactor.ts`, `operatorRegistry.ts`, `operatorManager.ts`, `config.ts`
**Effort:** 6 hours | ~180 LOC
**Default:** OFF (opt-in) — silent summarization can surprise users
**Config keys:** `memory.autoCompact: false`, `memory.compactThreshold: 40` (entries), `memory.observationMasking: true`
**DX:** Log when compaction happens: `[Drive] Compacting Alpha's memory (47 → 22 entries)`
**Security:** Raw transcripts always retained in event log. Summarization is display/prompt only.

### 3.2 Memory Tool (Persistent Per-Operator Notes)
**Why:** Operators need persistent memory that survives context compaction and session boundaries. The Claude Memory Tool API is purpose-built for this.

**What changes:**
- New: `src/memoryTool.ts` — File-based memory per operator at `~/.claude-drive/memories/<operatorId>/`. Operations: `view`, `create`, `str_replace`, `delete`, `list`.
- `operatorManager.ts` — Pass memory tool definition to SDK `query()` so operators can self-manage their notes.
- `mcpServer.ts` — Add `memory_note_save`, `memory_note_list`, `memory_note_read`, `memory_note_delete` MCP tools.

**Files touched:** New `memoryTool.ts`, `operatorManager.ts`, `mcpServer.ts`
**Effort:** 4 hours | ~110 LOC
**Default:** ON
**Security:** Memory files confined to operator's directory. `realpath()` blocks `../` escapes. 10MB cap per operator. No cross-operator access.

### 3.3 Strategy Memory (Learn From Past Runs)
**Why:** Operators currently start from zero every time. AutoResearch showed that tracking what worked/failed across runs dramatically improves quality.

**What changes:**
- New: `src/strategyStore.ts` — JSON store at `~/.claude-drive/strategies/<taskCategory>.json`. Records: task description, approach taken, outcome (success/failure), operator role, timestamp.
- `operatorManager.ts` — After operator completes, extract strategy summary and persist. Before new task, query matching strategies and inject into system prompt.
- Strategies are per-operator-role, not shared across roles (security agent requirement).

**Files touched:** New `strategyStore.ts`, `operatorManager.ts`, `config.ts`
**Effort:** 5 hours | ~130 LOC
**Default:** OFF (opt-in) — DX agent flagged unpredictable behavior
**Config key:** `memory.persistStrategy: false`
**DX:** When active, log: `[Alpha] Applying learned strategy: "prefer small atomic commits for refactors"`
**Security:** Strategies sanitized — strip file paths, credentials, command outputs. Only store approach descriptions and outcomes.

### 3.4 MCP Tool Filtering Per Role
**Why:** A `reviewer` operator doesn't need `worktree_create` or `tts_speak`. Reducing visible tools improves focus and reduces context window usage.

**What changes:**
- `mcpServer.ts` — Add role-based tool visibility. When `operator_spawn` is called with a role, the operator's MCP session only sees tools relevant to that role.
- New: `ROLE_TOOL_MAP` constant mapping role → allowed MCP tools:
  - `reviewer` → operator_*, agent_screen_*, drive_get_state (no worktree, no tts, no run)
  - `researcher` → operator_*, agent_screen_*, drive_get_state, tts_speak (no worktree, no merge)
  - `implementer` → all tools
  - `tester` → all tools
  - `planner` → operator_*, agent_screen_*, drive_set_mode, drive_get_state, tts_speak

**Files touched:** `mcpServer.ts`, `operatorRegistry.ts` (export role types)
**Effort:** 4 hours | ~100 LOC
**Default:** ON
**Config key:** `operators.toolVisibility: "role"` (options: `all | role | preset`)

**Phase 3 total: ~19 hours, 4 items**

---

## Phase 4: Advanced Features (Week 7+)

> Goal: Higher-risk items that need the Phase 1-3 foundation and careful rollout.

### 4.1 Merge Orchestration
**Why:** Currently worktrees are allocated but merging is manual. Operators finish work and the branch just sits there.

**What changes:**
- `worktreeManager.ts` — Add `mergeAndCleanup(operatorId, targetBranch)`: runs conflict detection first, then either auto-merges (if clean) or escalates to user.
- `operatorRegistry.ts` — On `dismiss()`, if operator has a worktree and `autoMergeSafety` is "auto", trigger merge. If "ask", queue approval via `approvalQueue.ts`.
- `mcpServer.ts` — Enhance `operator_dismiss` to accept `merge: boolean` parameter.

**Files touched:** `worktreeManager.ts`, `operatorRegistry.ts`, `mcpServer.ts`, `approvalQueue.ts`
**Effort:** 6 hours | ~160 LOC
**Default:** ASK mode (requires approval)
**Config key:** `operators.autoMerge: true`, `operators.autoMergeSafety: "ask"` (options: `ask | auto | manual`)
**Security (critical):** Never auto-merge to main/protected branches. Diff preview before merge. If operator was dismissed due to escalation, block merge entirely. Merge goes through approval queue.
**DX:** Log: `[Alpha] Merge ready: +142 lines, -23 lines, 3 files changed. Approve? [Y/n]`

### 4.2 Semantic Routing
**Why:** Keyword matching misroutes complex intents ("refactor to fix the bug" → plan, not debug). The `router.llmEnabled` config already exists but is unused.

**What changes:**
- `router.ts` — When `router.llmEnabled` is true, send the prompt to a fast/cheap model (Haiku) for intent classification. Return structured JSON: `{ mode, confidence, reason }`. Fall back to keyword matching if LLM fails or confidence < 0.7.
- Keep keyword matching as secondary layer (security agent requirement).

**Files touched:** `router.ts`, `config.ts`
**Effort:** 8 hours | ~120 LOC
**Default:** OFF
**Config keys:** `router.llmEnabled: false`, `router.classificationModel: "claude-haiku-4-5-20251001"`
**DX:** Log: `[Router] "refactor auth to fix login bug" → agent (confidence: 0.91, reason: "action verb + fix intent")`

**Phase 4 total: ~14 hours, 2 items**

---

## Dependency Graph

```
Phase 1 (Foundation)
  1.1 Event-sourced sessions ─────┐
  1.2 CLAUDE.md per worktree      │  (independent)
  1.3 Prompt caching              │  (independent)
  1.4 Operator retry + timeout    │  (independent)
                                  │
Phase 2 (Safety & SDK)            │
  2.1 PreToolUse hooks            │  (independent)
  2.2 Session resume/fork ◄───────┘  (needs 1.1 for event log)
  2.3 Adaptive thinking              (independent)
  2.4 Parallel tool execution        (independent)

Phase 3 (Intelligence)
  3.1 Memory compaction ◄──────── (needs 1.1 for raw transcript retention)
  3.2 Memory Tool                    (independent)
  3.3 Strategy memory ◄────────── (benefits from 3.1 compaction)
  3.4 MCP tool filtering             (independent)

Phase 4 (Advanced)
  4.1 Merge orchestration ◄────── (needs 2.1 hooks for approval enforcement)
  4.2 Semantic routing               (independent)
```

## Config Keys Summary

New keys added to `~/.claude-drive/config.json`:

```json
{
  "sessions.eventSourcing": true,
  "sessions.snapshotInterval": 50,
  "sessions.autoSave": true,

  "operators.maxRetries": 3,
  "operators.retryBackoffMs": 1000,
  "operators.timeoutMs": 300000,
  "operators.autoMerge": true,
  "operators.autoMergeSafety": "ask",
  "operators.toolVisibility": "role",

  "agents.promptCaching": true,
  "agents.adaptiveThinking": false,
  "agents.parallelTools": false,

  "memory.autoCompact": false,
  "memory.compactThreshold": 40,
  "memory.observationMasking": true,
  "memory.persistStrategy": false,

  "router.classificationModel": "claude-haiku-4-5-20251001"
}
```

## New CLI Commands

```bash
claude-drive session save <name>      # Save current session
claude-drive session restore <name>   # Restore session (with SDK resume)
claude-drive session fork <name>      # Fork session at current point
claude-drive session list             # List all sessions with event counts

claude-drive memory compact           # Manual memory compaction
claude-drive memory stats [operator]  # Memory usage per operator

claude-drive operator strategy show [name]  # View learned strategies
```

## New MCP Tools

```
session_fork          — Fork a session (Phase 2)
memory_note_save      — Save operator note (Phase 3)
memory_note_list      — List operator notes (Phase 3)
memory_note_read      — Read operator note (Phase 3)
memory_note_delete    — Delete operator note (Phase 3)
```

## Risk Register

| Risk | Severity | Mitigation | Phase |
|------|----------|------------|-------|
| Auto-merge brings malicious code to main | Critical | Approval gates, never auto-merge to protected branches | 4 |
| CLAUDE.md injection by operators | Critical | System-generated only, read-only, realpath() validation | 1 |
| PreToolUse hooks silently mutate commands | Critical | Hooks deny/allow only, NO input mutation | 2 |
| Strategy memory propagates bad patterns | High | Per-role isolation, sanitize stored strategies | 3 |
| Session resume with stale permissions | High | Re-check permissions on resume against current state | 2 |
| Memory compaction loses critical context | Medium | Raw transcripts always in event log, compaction is prompt-only | 3 |
| Semantic routing misclassifies dangerous intent | Medium | Keep keyword matching as secondary layer, confidence threshold | 4 |
| Retry loops on blocked operations | Medium | Re-check approval gates on each retry | 1 |

## Testing Strategy

**Phase 1:** Unit tests for event log append/read, CLAUDE.md generation, retry backoff logic. Integration test: full session → save → restore → verify events.

**Phase 2:** Unit tests for hook allow/deny decisions. Security tests: attempt tool execution after deny. Integration test: save session → resume with SDK session ID → verify conversation continuity.

**Phase 3:** Unit tests for observation masking (verify large outputs are stubbed). Unit tests for memory file CRUD with path traversal attempts. Integration test: run operator → check strategies recorded → run similar task → verify strategy injected.

**Phase 4:** Integration test: operator completes work → dismiss with merge → verify branch merged. Adversarial test: operator modifies operatorRegistry.ts → dismiss → verify merge blocked. Unit tests for LLM routing with mocked responses.
