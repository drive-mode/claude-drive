# claude-drive Improvement Plan v2

**Date:** 2026-03-30
**Status:** 40 files, ~5,943 LOC, 43 MCP tools, compiles clean

---

## Current State Assessment

claude-drive has grown from 19 → 40 files. The core feature set is strong: operators, sync orchestration, governance, memory, pipeline, TTS, approval gates. But the audit surfaced real problems that need fixing before adding more features.

**TL;DR:** Fix foundations first (bugs, persistence, tests), then add the high-value missing features (prompt optimizer, governance polish, agent screen).

---

## Tier 0: Bugs & Broken Things (Fix Now)

### 0.1 — Missing `tui.tsx` module
- `cli.ts:68` imports `./tui.js` but the file doesn't exist
- The `--tui` flag on `start` command is broken
- **Fix:** Either create a minimal Ink-based TUI or remove the `--tui` flag entirely
- **Effort:** S (remove flag) or L (implement TUI)
- **Recommendation:** Stub it out with a "coming soon" message for now

### 0.2 — In-memory state loss on restart
5 systems lose all state on server restart:
- Operator registry (active operators gone)
- Sync proposals (in-flight merges lost)
- Integration queue (pending merges lost)
- Worktree allocations (orphaned worktrees)
- Approval queue (pending approvals vanish)

**Fix:** Add checkpoint persistence to `~/.claude-drive/state/` for each. Load on startup, save on mutation.
- **Effort:** M (2-3 hours, straightforward JSON serialization)

### 0.3 — Silent error swallowing (8 locations)
Multiple modules catch errors and do nothing:
- `tts.ts:139` — TTS failure is invisible to user
- `commsAgent.ts:125` — API failures are silent
- `sessionManager.ts:47` — Failed operator restoration is swallowed
- `approvalQueue.ts:38` — Auto-deny is silent
- `tangentNameExtractor.ts:70` — Model parse failures fall through

**Fix:** Add `console.warn()` or route through `agentOutput.logActivity()` at minimum.
- **Effort:** XS (1 hour)

### 0.4 — Unused exports / dead code
7 exported functions are never called:
- `config.ts` → `setFlag()`
- `tts.ts` → `setOnPlaybackEnded()`
- `sessionManager.ts` → `trackEvent()`
- `glossaryExpander.ts` → `invalidateGlossaryCache()`
- `pipeline.ts` → `resetPipelineStats()`
- `sessionStore.ts` → `deleteSession()`
- `worktreeManager.ts` → `getAllocation()`

**Fix:** Mark with `// @internal` comments or remove if truly dead.
- **Effort:** XS

---

## Tier 1: Robustness (This Week)

### 1.1 — Atomic file writes for governance + sync
Governance scan and sync ledger write directly via `fs.writeFile`. A crash mid-write corrupts the file.

**Fix:** Port cursor-drive's `fsUtils.ts` pattern:
```typescript
async function writeJsonAtomic(path, data) {
  const tmp = path + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, path);  // atomic on POSIX
}
```
- **Effort:** S

### 1.2 — Governance schema validation
Governance types are plain TS interfaces with no runtime validation. Malformed data passes silently.

**Fix:** Add Zod schemas (port from cursor-drive's `governance/schemas.ts`). Validate on read/write boundaries.
- **Effort:** S

### 1.3 — Governance CLI subcommand
No way to run a governance scan standalone. Currently only accessible via MCP tool.

**Fix:** Add `claude-drive governance scan [--root <path>]` subcommand to `cli.ts`.
- **Effort:** XS

### 1.4 — Config schema + validation
Config keys are scattered across 15+ files with no central documentation. Invalid config values fail silently.

**Fix:** Create `src/configSchema.ts` with a Zod schema for all config keys. Validate on load. Log warnings for unknown keys.
- **Effort:** M

### 1.5 — Structured logging
No persistent log file. Debugging requires reproducing the issue.

**Fix:** Add a rotating log file at `~/.claude-drive/logs/`. Route `agentOutput` events + errors through it.
- **Effort:** S

---

## Tier 2: Missing Features (Next 1-2 Weeks)

### 2.1 — Prompt Optimizer
Voice input is messy. Cursor-drive uses a cheap model to clean it up before routing.

**Port from:** `cursor-drive/src/promptOptimizer.ts`
- Skip optimization for short/clean prompts (<80 chars)
- Use haiku-tier model for fast cleanup
- Track original vs optimized for debugging
- **Effort:** S

### 2.2 — Mode Switcher with validation
Currently `driveMode.setSubMode()` accepts any string. No validation, no confirmation.

**Port from:** `cursor-drive/src/modeSwitcher.ts`
- Validate mode transitions (e.g., can't go from `off` to `debug` directly)
- Add semantic matching ("switch to planning" → `plan`)
- **Effort:** S

### 2.3 — Governance AI Summary
Entropy reports are numbers. Humans want "your 3 biggest risks are X, Y, Z."

**Port from:** `cursor-drive/src/governance/aiSummary.ts`
- Feed entropy report + task ledger to haiku
- Return structured summary with confidence flag
- **Effort:** S

### 2.4 — Governance directory structure
Currently writes to `.drive/governance/` ad-hoc. No standard layout.

**Port from:** `cursor-drive/src/governance/paths.ts`
- Standard dirs: snapshots, reports, tasks, history, mermaid
- Auto-create on first scan
- **Effort:** XS

### 2.5 — Session Accumulator (cursor-sdk port)
Cursor-drive's `SessionAccumulator` handles late-arriving tool call updates with delta merging. Claude-drive's session handling is simpler but brittle.

**Port from:** `cursor-drive/src/cursor-sdk/sessionAccumulator.ts`
- Delta merging for tool call args/results
- Immutable snapshot emission
- Late-arrival tolerance
- **Effort:** M

### 2.6 — PermissionBroker (cursor-sdk port)
Bridges external permission requests → Drive approval gates. More extensible than direct approvalGates calls.

**Port from:** `cursor-drive/src/cursor-sdk/permissionBroker.ts`
- Map capability requests to gate outcomes
- Fallback chain: allow → approved, block → rejected
- **Effort:** M

---

## Tier 3: Polish & UX (Weeks 3-4)

### 3.1 — Agent Screen (visual operator activity)
The biggest UX gap. Users see raw stdout logs. No structured view of what operators are doing.

**Approach options:**
1. **Terminal UI (Ink):** Rich terminal rendering with tabs (Activity, Files, Decisions). Works in any terminal.
2. **Web dashboard:** Serve a local HTML page from the MCP server. Auto-refresh via SSE.
3. **MCP resource:** Expose agent screen state as MCP resource. Let Claude Code render it.

**Recommendation:** Option 2 (web dashboard). Easiest to implement, works everywhere, can reuse cursor-drive's HTML template.
- **Effort:** L (but high impact)

### 3.2 — Clarification Handler
When TTS is speaking and user interrupts, decide: continue, modify, or abandon?

**Port from:** `cursor-drive/src/clarificationHandler.ts`
- Uses cheap model for fast validation
- Returns merged content when input refines prior response
- **Effort:** M

### 3.3 — Governance history visualization
NDJSON history exists but nothing reads it. Add:
- `claude-drive governance history` — show entropy score trend
- Mermaid chart generation for reports
- **Effort:** S

### 3.4 — Retry with jitter in operatorManager
Current retry uses `4^n` backoff with no jitter. Thundering herd risk with multiple operators.

**Fix:** Add ±25% jitter: `delay * (0.75 + Math.random() * 0.5)`
- **Effort:** XS

### 3.5 — Governance snapshot caching
`buildProjectGraphSnapshot()` walks the entire file tree every call. Expensive for large repos.

**Fix:** Cache snapshot for 5 minutes. Invalidate on explicit request.
- **Effort:** S

### 3.6 — Persistent memory full-text index
BM25-lite search is O(n) over files. Fine for 30 days, slow for larger histories.

**Fix:** Build inverted index on first search, cache in memory.
- **Effort:** M

---

## Tier 4: Strategic (Future)

### 4.1 — Cloud Agent Client
Launch remote agents for autonomous repo work. Parallel execution beyond local.

**Port from:** `cursor-drive/src/cloudAgentClient.ts`
- REST client with retry + auth fallback
- Artifact download
- Only if multi-agent roadmap is confirmed
- **Effort:** M-L

### 4.2 — Plugin/Skill Installer
Auto-deploy skills and commands to `.claude/`.

**Port from:** `cursor-drive/src/pluginInstaller.ts`
- Version stamping, requirement gating
- **Effort:** M

### 4.3 — Snapshot Feed infrastructure
Contract for future pixel-streaming (screenshots, terminal captures, diffs).

**Port from:** `cursor-drive/src/snapshotFeed.ts` (interface-only)
- **Effort:** XS (interfaces only, no implementation)

---

## Effort Summary

| Tier | Items | Est. Hours | Description |
|------|-------|-----------|-------------|
| 0 | 4 | 6-8h | Bugs and broken things |
| 1 | 5 | 8-12h | Robustness foundations |
| 2 | 6 | 12-18h | Key missing features |
| 3 | 6 | 16-24h | Polish and UX |
| 4 | 3 | 12-20h | Strategic features |
| **Total** | **24** | **~55-80h** | |

---

## Recommended Execution Order

**Week 1:** Tier 0 (all) + Tier 1.1, 1.2, 1.3, 1.5
**Week 2:** Tier 1.4 + Tier 2.1, 2.2, 2.3, 2.4
**Week 3:** Tier 2.5, 2.6 + Tier 3.1 (start agent screen)
**Week 4:** Tier 3.1 (finish) + Tier 3.2, 3.4, 3.5
**Ongoing:** Tier 4 items as roadmap confirms need
