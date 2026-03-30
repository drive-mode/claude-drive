# cursor-drive vs claude-drive: Feature Gap Analysis

**Date:** March 28, 2026
**Purpose:** Identify features in cursor-drive worth porting to claude-drive, prioritized by impact.

---

## The Numbers

| Metric | cursor-drive | claude-drive | Gap |
|--------|-------------|-------------|-----|
| Source files | 48 files | 19 files | 29 files |
| Lines of code | ~11,118 | ~2,679 | ~8,400 |
| MCP tools | 70+ | 26 | ~44 tools |
| Config options | 100+ | 30 | ~70 options |
| Memory systems | 3 (session + persistent + glossary) | 1 (operator memory[]) | 2 systems |
| Sync components | 5 (git, worktree, ledger, coordinator, queue) | 2 (git, worktree) | 3 components |
| Pipeline stages | 10 | 0 (no pipeline) | full pipeline |
| Governance modules | 5 | 0 | full governance |

---

## Feature Gap Matrix

### TIER 1: High Impact, Already Node.js-Ready (Port These First)

These features have zero VS Code dependency and bring massive capability gains.

#### 1. Persistent Memory System
**cursor-drive:** `persistentMemory.ts` (~200 LOC)
**claude-drive:** Nothing equivalent

Two-layer Markdown memory:
- **Curated facts** → `.drive/MEMORY.md` (long-term knowledge base, agent-editable)
- **Daily logs** → `.drive/memory/YYYY-MM-DD.md` (append-only, auto-timestamped)
- **BM25-lite search** across last 30 days of logs
- **Auto-pruning** of logs older than N days
- **Context injection** → curated + yesterday + today concatenated into prompt

**Why it matters:** Operators currently lose ALL context between sessions. This gives them cross-session memory with zero external dependencies (pure fs/promises).

**Effort:** ~4 hours. Already pure Node.js code.

**New MCP tools:**
- `persistent_memory_append` — write to daily log
- `persistent_memory_search` — BM25 keyword search
- `persistent_memory_write_curated` — overwrite MEMORY.md
- `persistent_memory_context` — get full memory context string

---

#### 2. Session Memory with Compaction
**cursor-drive:** `sessionMemory.ts` (~150 LOC)
**claude-drive:** `operatorRegistry.memory[]` (50-entry cap, no compaction)

Rich session memory with:
- **Entry types:** turn, task, pending, decision, compaction-summary
- **Compaction:** At 80% capacity, compress oldest half into summary entry (preserving decisions)
- **Token budget:** ~500 chars per context injection (prevents bloat)
- **Visibility modes:** isolated | shared | collaborative (per-operator scoping)
- **Operator-scoped views:** `forOperator(id)` returns filtered context

**Why it matters:** Current 50-entry flat array with no compaction = operators lose important early context. Compaction preserves decisions while evicting raw turns. Visibility modes enable true multi-operator isolation vs collaboration.

**Effort:** ~6 hours. Replace `vscode.Memento` with `store.ts`.

---

#### 3. StateSyncCoordinator + SyncLedger + IntegrationQueue
**cursor-drive:** 3 files, ~600 LOC total
**claude-drive:** Only basic worktree create/merge

The full merge orchestration stack:
- **StateSyncCoordinator** — snapshot computation, conflict detection, proposal lifecycle
- **SyncLedger** — append-only JSON ledger of all sync decisions (audit trail)
- **IntegrationQueue** — FIFO queue with mutex for applying proposals safely

**Sync flow:**
```
Operator completes work → coordinator detects commits
  → generates SyncProposal { changedFiles, conflictFiles, status }
  → user reviews via MCP tool
  → approved → IntegrationQueue processes (rebase/merge)
  → ledger records decision with timestamp
```

**Why it matters:** claude-drive's `worktree_merge` does a raw `git merge --no-ff` with no conflict detection, no proposal review, no audit trail. Multiple operators merging simultaneously = race conditions and lost work.

**Effort:** ~8 hours. `syncLedger.ts` and `integrationQueue.ts` are pure Node.js. `stateSyncCoordinator.ts` uses git only.

**New MCP tools:**
- `sync_status` — full snapshot of all operator worktrees
- `sync_proposal_list` — list pending merge proposals
- `sync_proposal_apply` — approve and execute merge

---

#### 4. Governance System
**cursor-drive:** `governance/` directory (5 modules, ~750 LOC)
**claude-drive:** Nothing equivalent

Modules:
- **entropy.ts** — code complexity metrics (coupling, duplication, module size)
- **projectGraph.ts** — dependency graph analysis, cycle detection, layering violations
- **focusGuard.ts** — validates operator stayed within declared task scope (files touched vs task description)
- **taskLedger.ts** — append-only task log with timestamps, operators, status
- **aiSummary.ts** — AI-generated entropy summary for user reports

**Why it matters:** Without governance, operators have no guardrails on scope creep. focusGuard catches when an operator assigned "fix auth bug" starts editing unrelated files. taskLedger provides an audit trail. entropy metrics give health signals.

**Effort:** ~10 hours. Only `aiSummary.ts` needs model access (use Claude SDK).

---

#### 5. Tool Permission Allowlist System
**cursor-drive:** `toolAllowlist.ts` (~100 LOC)
**claude-drive:** `operatorManager.ts` lines 13-15 (hardcoded arrays)

Structured per-preset allowlist:
```
READONLY: agent_screen_*, tts_*, persistent_memory_*, drive_get_state, operator_list, sync_*, steering_stats
STANDARD: readonly + cursor_cli_*, operator_spawn/switch/dismiss, worktree_create, sync_proposal_apply
FULL: * (all tools)
```

**Why it matters:** claude-drive's current tool filtering is in `operatorManager.ts` and only controls which Agent SDK tools operators can use. It doesn't filter MCP tools at all — any operator can call any MCP tool regardless of permission preset. This is a security gap.

**Effort:** ~3 hours. Extract into dedicated module, add MCP tool checking.

---

### TIER 2: High Impact, Needs Some Adaptation

These have VS Code UI dependencies that need CLI equivalents.

#### 6. Prompt Pipeline
**cursor-drive:** `pipeline.ts` (~350 LOC) + 4 helper modules
**claude-drive:** Nothing (prompts go straight to operators)

10-stage processing:
1. Wake word detection → activate drive
2. Filler cleaning → remove "uh", "um", "like"
3. Glossary expansion → user-defined abbreviations
4. Sanitization → redact API keys, truncate
5. Prompt optimization → AI rewrite for clarity
6. Approval gates → block/warn/log
7. Session memory injection → prepend context
8. Persistent memory injection → append history
9. Intent routing → plan/agent/ask/debug
10. Model selection → tier-based routing

**What to port for CLI:**
- Stages 2-4 are simple text transforms (pure functions, no VS Code)
- Stage 6 already exists in claude-drive
- Stages 7-8 need the memory systems above
- Stages 5, 9-10 need model access
- Stages 1 isn't relevant for CLI (no voice input initially)

**Why it matters:** Without a pipeline, raw user input goes directly to operators with no sanitization, no context enrichment, no routing intelligence. The pipeline is the "brain" that makes drive mode smart.

**Effort:** ~12 hours. Pipeline orchestrator + port helpers.

---

#### 7. CommsAgent (Operator Status Reporter)
**cursor-drive:** `commsAgent.ts` (~200 LOC)
**claude-drive:** Nothing equivalent

Background service that:
- Queues operator completion/progress/sync events (max 100)
- Flushes after N seconds of idle (batching)
- Uses cheap model to generate 1-2 sentence summary
- Falls back to raw event list if model unavailable
- Optional TTS announcement

**Why it matters:** With multiple operators running, the user has no way to know what happened unless they manually check. CommsAgent is the "narrator" that summarizes progress naturally.

**Effort:** ~6 hours. Replace `vscode.LanguageModelChat` with Claude SDK.

---

#### 8. Tangent Flow
**cursor-drive:** `tangentFlow.ts` + `tangentNameExtractor.ts` (~250 LOC)
**claude-drive:** Nothing (operators must be spawned explicitly)

Natural language operator spawning:
```
"Refactor auth module, and tangent — research Clerk integration"
  → Main task: "Refactor auth module" (current operator)
  → Tangent: spawn researcher operator for "Research Clerk integration"
```

Features:
- Keyword detection (configurable, default: "tangent")
- Name + task extraction from natural language
- Confirmation loop (confirm / edit / cancel)
- Auto-confirm option for power users

**Why it matters:** This is the UX magic of drive mode — you casually mention a side task and it spawns an operator automatically. Without it, multi-operator is just a manual API.

**Effort:** ~4 hours. Replace modal with CLI prompt.

---

#### 9. Model Selector (Tiered Model Routing)
**cursor-drive:** `modelSelector.ts` (~150 LOC)
**claude-drive:** Nothing (always uses same model)

Cost-based model selection:
```
routing tier   → haiku (cheap, fast) — filler cleaning, intent detection
planning tier  → sonnet (mid) — plan creation, analysis
execution tier → sonnet (mid) — code generation
reasoning tier → opus (expensive) — deep debugging, architecture
```

**Why it matters:** Using opus for everything is expensive. Using haiku for everything is dumb. Tiered routing puts the right model on the right task.

**Effort:** ~4 hours. Map to Claude model family.

---

### TIER 3: Medium Impact, Nice to Have

#### 10. Sanitizer
**cursor-drive:** `sanitizer.ts` (~100 LOC)
**claude-drive:** Nothing

Redacts API keys, passwords, tokens from prompts before processing. Truncates oversized prompts. Basic prompt injection defense.

**Effort:** ~2 hours (pure text transforms)

#### 11. Filler Cleaner
**cursor-drive:** `fillerCleaner.ts` (~80 LOC)
**claude-drive:** Nothing

Removes "uh", "um", "like", "you know" etc. from voice dictation. Only relevant if voice input is added later.

**Effort:** ~1 hour (pure regex)

#### 12. Glossary Expander
**cursor-drive:** `glossaryExpander.ts` (~60 LOC)
**claude-drive:** Nothing

User-defined abbreviation expansions. E.g., "cd" → "create deployment". Useful for voice and shorthand.

**Effort:** ~1 hour (config lookup + string replace)

#### 13. Clarification Handler
**cursor-drive:** `clarificationHandler.ts` (~150 LOC)
**claude-drive:** Nothing

Interactive prompt refinement when input is ambiguous: continue / modify / abandon. Prevents wasted operator cycles on unclear tasks.

**Effort:** ~3 hours (CLI prompt adaptation)

#### 14. Prompt Optimizer
**cursor-drive:** `promptOptimizer.ts` (~150 LOC)
**claude-drive:** Nothing

AI-powered voice-to-text improvement. Rewrites messy dictation for clarity. Uses cheap model.

**Effort:** ~3 hours (Claude SDK call)

---

### TIER 4: Low Priority / Not Applicable

These are cursor-specific or VS Code-specific features that don't make sense for CLI.

| Feature | Reason to Skip |
|---------|---------------|
| Agent Screen Webview | VS Code-specific UI. claude-drive has terminal output + TUI |
| Status Bar | VS Code-specific. CLI has no persistent status bar |
| Sidebar Panel | VS Code-specific |
| Cloud Agents | Cursor API-specific. Could add Claude API equivalent later |
| Web Speech TTS | Browser-only. claude-drive already has edgeTts/piper/say |
| Plugin Installer | Cursor plugin system. Not applicable |
| API Discovery | VS Code API introspection. Not applicable |
| MCP Apps | Cursor 2.6+ inline UI. Not applicable |
| Voice Commands | Requires mic input. Future enhancement |
| Native Mode Sync | Cursor composerMode API. Not applicable |

---

## Recommended Implementation Order

### Phase A: Memory Foundation (Week 1, ~13 hours)
1. **Persistent Memory** (4h) — cross-session knowledge
2. **Session Memory with Compaction** (6h) — rich per-session context
3. **Tool Permission Allowlist** (3h) — security fix

### Phase B: Orchestration (Week 2, ~12 hours)
4. **Tangent Flow** (4h) — natural operator spawning
5. **Sync Coordinator + Ledger + Queue** (8h) — safe merge orchestration

### Phase C: Intelligence (Week 3, ~16 hours)
6. **Prompt Pipeline** (12h) — full processing chain
7. **Model Selector** (4h) — cost-optimized model routing

### Phase D: Governance & Polish (Week 4, ~16 hours)
8. **Governance System** (10h) — scope guard, entropy, task ledger
9. **CommsAgent** (6h) — operator status narration

### Phase E: Text Processing (Week 4-5, ~10 hours)
10. **Sanitizer** (2h)
11. **Glossary Expander** (1h)
12. **Filler Cleaner** (1h)
13. **Clarification Handler** (3h)
14. **Prompt Optimizer** (3h)

**Total: ~67 hours across 5 phases**

---

## How This Merges With the Existing Implementation Plan

The previous implementation plan (14 items, 73 hours) focused on Claude-specific improvements: event-sourced sessions, prompt caching, Memory Tool, adaptive thinking, PreToolUse hooks, etc.

This comparison reveals cursor-drive features that the previous plan missed or handled differently. Here's the merge strategy:

### Already Covered (overlap)
- **Memory compaction** → Previous plan Item 9 covers observation masking + dynamic summarization. Cursor-drive's `sessionMemory.compact()` is a simpler, immediately-portable version. **Use cursor-drive's approach as Phase 1, upgrade to Claude-native later.**
- **Merge orchestration** → Previous plan Item 13 covers this. Cursor-drive has a working implementation to port. **Port cursor-drive's code directly.**
- **Semantic routing** → Previous plan Item 14. cursor-drive's `modelSelector.ts` is a simpler version. **Port as foundation, enhance with Claude-native routing later.**
- **MCP tool filtering** → Previous plan Item 12. cursor-drive's `toolAllowlist.ts` is the reference. **Port directly.**

### New Items (not in previous plan)
- **Persistent Memory** — Cross-session Markdown memory. Not the same as Memory Tool (Claude API). Complementary.
- **Prompt Pipeline** — Full processing chain. Previous plan assumed operators get raw prompts.
- **Tangent Flow** — Natural language operator spawning. Previous plan didn't cover this.
- **CommsAgent** — Background status batching. Previous plan didn't cover this.
- **Governance** — Focus guard, entropy, task ledger. Previous plan didn't cover this.
- **Sanitizer** — Prompt sanitization. Previous plan didn't cover this.
- **Glossary/Filler/Optimizer** — Text processing pipeline stages.
- **Clarification Handler** — Interactive refinement.

### Revised Combined Estimate
- Previous plan: 73 hours (Claude-native improvements)
- This comparison: 67 hours (cursor-drive ports)
- Overlap savings: ~15 hours (items already covered)
- **Combined total: ~125 hours (~6 weeks full-time, ~12 weeks at 50%)**

---

## Architecture After Full Port

```
User Input (CLI or MCP)
    ↓
┌─────────────────────────────────────────┐
│ PROMPT PIPELINE                         │
│ filler clean → glossary → sanitize      │
│ → optimize → approval gates             │
│ → session memory inject                 │
│ → persistent memory inject              │
│ → intent route → model select           │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ OPERATOR REGISTRY                       │
│ spawn / switch / dismiss / pause        │
│ tangent detection & auto-spawn          │
│ permission cascades                     │
│ role templates (impl/review/test/...)   │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ OPERATOR MANAGER (Agent SDK)            │
│ query() with tool permissions           │
│ PreToolUse hooks (approval gates)       │
│ PostToolUse hooks (file logging)        │
│ adaptive thinking (extended thinking)   │
│ session resume/fork                     │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ GOVERNANCE                              │
│ focus guard (scope validation)          │
│ entropy metrics (code health)           │
│ task ledger (audit trail)               │
│ project graph (dependency analysis)     │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ SYNC ORCHESTRATION                      │
│ StateSyncCoordinator (proposals)        │
│ IntegrationQueue (safe merges)          │
│ SyncLedger (audit log)                  │
│ WorktreeManager (git isolation)         │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ MEMORY SYSTEMS                          │
│ Session Memory (compaction, visibility) │
│ Persistent Memory (daily logs, curated) │
│ Memory Tool (Claude API, long-term)     │
│ Operator memory[] (per-agent notes)     │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│ OUTPUT                                  │
│ AgentOutput (terminal/TUI)              │
│ CommsAgent (batched status reports)     │
│ TTS (edgeTts/piper/say)                │
│ MCP Server (26+ tools → Claude Code)   │
└─────────────────────────────────────────┘
```

---

## Key Insight

cursor-drive is ~4x larger than claude-drive, but roughly 70% of that code is **already Node.js-ready** (no VS Code APIs). The remaining 30% is UI (webviews, status bar, modals) that we don't need for CLI.

The most valuable ports are the **memory systems**, **sync orchestration**, and **prompt pipeline** — these are the "brains" of drive mode that make multi-operator coordination actually work rather than just being a fancy way to spawn subagents.
