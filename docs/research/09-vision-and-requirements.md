# 09 — Vision & Requirements

> **Synthesized from:** 8 research documents (01–08) | **Date:** 2026-03-26

---

## 1. Product Vision

**claude-drive** is a multi-operator orchestration daemon that turns Claude Code CLI into a voice-first, human-in-loop AI pair programming environment. It manages named operators with role-based permissions, typed semantic memory, approval safety gates, and git worktree isolation — capabilities that go beyond what native Claude Code agent teams provide.

**Target user:** Professional developer running 2–10 parallel AI coding tasks who needs operator identity persistence, cost visibility, permission inheritance, and approval gates.

**Value prop vs Claude Code alone:** Claude Code gives you one agent. claude-drive gives you a team — with memory that persists, roles that enforce discipline, costs tracked per operator, and safety gates that prevent destructive operations.

**The 10x moment:** When operators become native Claude Code agent team members — spawn via `/spawn`, monitor in the sidebar, approve via elicitation, resume with full transcript memory. That's when parallel AI coding becomes effortless.

---

## 2. Unix Philosophy Scorecard

| Principle | Score | Evidence |
|-----------|-------|----------|
| Do one thing well | 4/5 | Most files have clear single responsibility. mcpServer.ts (684 LOC) is the exception — should modularize tools. |
| Compose through interfaces | 4/5 | Clean EventEmitter patterns, JSON-serializable state, MCP tool surface. Operator → SDK query() is well-composed. |
| Text as universal interface | 5/5 | All state is JSON. Status file, config, memory, sessions — all text-based. Port file is plain text. |
| Small is beautiful | 3/5 | 9 files exceed 200 LOC. mcpServer.ts (684), cli.ts (482), operatorRegistry.ts (416), checkpoint.ts (246), skillLoader.ts (232). |
| Fail fast and loud | 3/5 | SDK import failure is SILENT (console.error + return). Store/config I/O errors caught and swallowed. Hook failures logged but don't propagate. |
| No premature abstraction | 4/5 | OperatorVisibility tracked but never enforced. PermissionPreset "full" identical to "standard". 11 dead config keys. |
| No dead code | 3/5 | SSE broadcast (`setSseBroadcast`) is dead code. `approval_request` tool is incomplete. `readline` dependency unused. |
| Explicit over clever | 4/5 | Mostly explicit. Router keyword matching is simple substring. Config priority chain is clear. |

**Overall Grade: B+ (30/40)**

**Top 3 Refactors:**
1. Split mcpServer.ts into tool modules (684 → ~4×170 LOC)
2. Fix silent failures: fail fast on SDK import at startup, not lazy in runOperator
3. Remove dead code: SSE broadcast, unused `readline`, dead config keys, `OperatorVisibility`

---

## 3. Feature Maturity Matrix

| Feature | Status | Windows 11 | iOS | Notes |
|---------|--------|-----------|-----|-------|
| MCP Server (HTTP) | Complete | ✅ | N/A | Port fallback, atomic port file |
| MCP Server (stdio) | Complete | ✅ | N/A | For Claude Desktop |
| Operator Lifecycle | Complete | ✅ | N/A | Spawn/switch/dismiss/merge/pause |
| Role System | Complete | ✅ | N/A | 5 roles, 3 presets |
| SDK Integration | Complete | ✅ | N/A | query() with streaming |
| Drive Mode | Complete | ✅ | N/A | 5 modes, persisted |
| Router | Complete | ✅ | N/A | Keyword matching |
| Approval Gates | Complete | ⚠️ Untested | N/A | Empty operatorId bypass |
| Approval Queue | Partial | ⚠️ | N/A | Lost on restart, 30s auto-deny |
| Worktree Isolation | Complete | ⚠️ Untested | N/A | No persistence of allocations |
| Memory System | Complete | ✅ | N/A | Typed, atomic persistence |
| Auto-Dream | Complete | ✅ | N/A | Prune/decay/merge/promote |
| Hooks | Partial | ⚠️ | N/A | 5/12 events wired |
| Skills | Partial | ✅ | N/A | Loaded but MCP integration done |
| Checkpoints | Complete | ✅ | N/A | Create/restore/fork/prune |
| Sessions | Complete | ⚠️ | N/A | Non-atomic writes |
| TTS (Edge) | Complete | ✅ | ❌ | Internet required |
| TTS (Piper) | Complete | ✅ | ❌ | Manual binary setup |
| TTS (System) | Partial | ❌ | ❌ | macOS only |
| Status Line | Complete | ✅ | N/A | Bash script generation |
| Cost Tracking | Partial | ✅ | N/A | Post-execution only |
| Model Routing | Not Started | — | — | Single model for all |
| Prompt Caching | Not Started | — | — | No cache_control |
| MCP Channels | Not Started | — | — | Pull-based only |
| Plugin Packaging | Not Started | — | — | Manual install |
| Mobile Dashboard | Not Started | — | ❌ | No REST/SSE endpoints |

---

## 4. MVP Definition — Windows 11

### Install → Start → Connect → Use → Merge

| Step | Current State | Blockers | Fix Complexity |
|------|--------------|----------|----------------|
| `npm install` | ✅ Works | SDK on `latest` (fragile) | Trivial — pin version |
| `npm run compile` | ✅ Works | None | — |
| `claude-drive start` | ✅ Works | None | — |
| Connect to Claude Code | ✅ Works | Manual settings.json edit | Trivial — install command |
| Spawn operator | ✅ Works | None | — |
| Run task | ✅ Works | No task cancellation on dismiss | Moderate — AbortController |
| Worktree isolation | ⚠️ Untested | Windows path length (260 chars) | Moderate — test + validate |
| Approval flow | ⚠️ Partial | 30s auto-deny, no persistence | Moderate — elicitation |
| Merge results | ✅ Works | No auto-cleanup post-merge | Trivial |
| Session restore | ⚠️ Partial | Non-atomic writes, memory lost | Moderate — atomic writes |

### Windows-Specific Issues
- Hook execution: `execSync` without `shell: true` — bash scripts fail on Windows
- Path length: worktree paths not validated against 260-char limit
- TTS system `say`: not available on Windows (Edge TTS works)

---

## 5. iOS Quick Wins

**What can be built in 1–2 days using existing infrastructure:**

1. **Read-only status page** — MCP server serves static HTML at `/dashboard`. Reads `status.json`. Shows operators, mode, costs. ~100 LOC.

2. **SSE activity feed** — Wire `setSseBroadcast()` (currently dead code). Push operator events via SSE on port 7892. Mobile Safari can consume. ~50 LOC.

3. **REST status endpoint** — `GET /api/status` returns `status.json` content. `GET /api/operators` returns active list. ~30 LOC.

4. **Mobile approval page** — HTML form at `/approve`. Lists pending approvals. POST to approve/deny. ~150 LOC.

**Total for basic mobile dashboard: ~330 LOC, 2 days.**

---

## 6. Claude Code Ecosystem Fit

### Integration Opportunities (from doc 07)

| Feature | Action | Priority |
|---------|--------|----------|
| Agent Teams | Map operators to native AgentDefinition | CRITICAL |
| MCP Channels | Push events instead of polling | HIGH |
| MCP Elicitation | Replace approval queue with native UI | HIGH |
| Skills as Slash Commands | `/spawn`, `/operators`, `/costs` | HIGH |
| SDK Session Resume | Persist sessionId, pass to `resume:` | HIGH |
| Session Transcripts | Inject prior transcript on restore | HIGH |
| Native Worktrees | Use `isolation: "worktree"` option | LOW |
| SDK Agent Definitions | Adopt AgentDefinition type | LOW |
| Plugin Distribution | Publish to Claude Code registry | MEDIUM |
| Enhanced Status Line | Colors, OSC 8 links, cost bars | MEDIUM |

### SDK & Ecosystem Utilization Matrix

| SDK/CC Feature | Current Usage | Potential |
|----------------|--------------|-----------|
| `query()` | ✅ Core integration | Fully used |
| `resume: sessionId` | ❌ Captures but doesn't persist | Operator persistence across restarts |
| `AgentDefinition` | ❌ Uses string-keyed records | Standard type with metadata |
| `AgentTeam` | ❌ Not used | Native team coordination |
| `isolation: "worktree"` | ❌ Custom implementation | Simplify worktree management |
| MCP Channels | ❌ Not used | Real-time operator events |
| MCP Elicitation | ❌ Not used | Native approval UI |
| Skills/Slash Commands | ❌ Custom loader | Native `/spawn`, `/drive-mode` |
| Hooks (SDK native) | ⚠️ Partial mapping | Unified hook system |
| `cache_control` | ❌ Not used | 90% savings on cached prompts |
| Model selection | ❌ Single model | Route by role for savings |
| `speed: "fast"` | ❌ Not used | Faster simple operators |
| `maxThinkingTokens` | ❌ Not used | Better planner output |
| Batch API | ❌ Not used | 50% savings on async tasks |

---

## 7. API Cost Optimization

### Savings Summary (from doc 08)

| Optimization | Savings/yr | Priority |
|-------------|-----------|----------|
| Model Routing by Role | $24K–$30K | P0 |
| Prompt Caching | $12K–$18K | P0 |
| Rate Limit Backpressure | $8K–$12K | P1 |
| Batch API | $8K–$12K | P1 |
| Extended Thinking | Quality ROI | P1 |
| Token Counting Gates | $4K–$6K | P2 |
| Structured Outputs | $3K–$5K | P2 |
| Fast Mode | $3K–$6K | P2 |
| **Total** | **$64K–$90K** | |

### Implementation: Static prompt → cacheable; dynamic memory → ephemeral cache_control. Role-to-model map: researcher→Haiku, reviewer→Haiku, tester→Sonnet, implementer→Sonnet, planner→Opus.

---

## 8. Roadmap

### P0 — MVP Blockers (This Week)

1. **Pin SDK versions** — `latest` → exact version in package.json
2. **Remove unused `readline` dependency**
3. **Fail fast on SDK import** — check at startup, not in runOperator
4. **Atomic writes for all persistence** — sessions, checkpoints, config, store (use .tmp+rename pattern)
5. **Add AbortController to runOperator** — cancel on dismiss, prevent runaway costs
6. **Validate operatorId in approval gates** — prevent throttle bypass
7. **Enforce `operators.maxConcurrent`** — config exists but never checked
8. **Add mutex to OperatorRegistry** — prevent concurrent spawn/dismiss race

### P1 — First Week: Stability & Quality

1. **Complete hook integration** — wire remaining 7 of 12 events
2. **Remove dead code** — SSE broadcast, dead config keys, OperatorVisibility
3. **Model routing by role** — Haiku for researchers, Opus for planners
4. **Prompt caching** — separate static/dynamic prompt, add cache_control
5. **SDK session resume** — persist sessionId, pass to `resume:` on restore
6. **Add 5 high-priority integration tests** — MCP startup, worktree safety, CLI lifecycle
7. **Wire Jest coverage** — set 70% threshold

### P2 — First Month: Compelling Features

1. **MCP channels** — push operator events, real-time approvals
2. **MCP elicitation** — replace approval queue with native UI
3. **Native skills** — `/spawn`, `/operators`, `/costs`, `/drive-mode`
4. **Agent teams integration** — map operators to AgentDefinition
5. **Mobile dashboard** — REST endpoints + SSE + HTML status page
6. **Extended thinking for planners** — configurable maxThinkingTokens
7. **Batch API for non-urgent tasks** — reviews, docs, tests
8. **Split mcpServer.ts** — into tool modules (~4×170 LOC)

### P3 — Future: Scale & Polish

1. **Plugin distribution** — publish to Claude Code registry
2. **iOS native wrapper** — against REST API
3. **Web dashboard** — full operator management UI
4. **Enhanced status line** — colors, OSC 8 links, cost bars
5. **Distributed locks** — file-based for multi-process safety
6. **Rate limit backpressure** — proactive queue management from headers
7. **Structured outputs** — schema validation on operator responses
8. **Auto-checkpoint** — implement sessions.autoCheckpoint with timer

---

## 9. Agent SDK Architecture Review

### Is claude-drive using the SDK idiomatically?

**Mostly yes.** The `query()` → async iterator → result extraction pattern is clean and correct. System prompt construction, tool filtering, and cost extraction follow SDK conventions.

**Anti-patterns:**
- Lazy SDK import in runOperator (should validate at startup)
- `void runOperator()` fire-and-forget without `.catch()` — swallows errors
- Subagent defs rebuilt every call instead of cached
- No AbortController for task cancellation
- Rate limit event logged but comment says "pausing" when it doesn't actually pause

### Could the operator/registry pattern be simplified?

**No — it's the right abstraction.** The SDK is stateless (`query()` is a pure function); the registry owns state. This is clean separation. The registry adds: permission hierarchy, foreground/background management, cascading dismiss, merge, escalation — none of which the SDK provides.

**However:** Foreground/background is a UI concern that could be separated from the registry. The registry should manage lifecycle; a separate "focus manager" should handle which operator is displayed.

### Should claude-drive be decomposable into SDK agents?

**Partially.** The daemon process (MCP server, config, hooks, sessions) should remain a single process. But operators could be expressed as `AgentDefinition` objects rather than ad-hoc `OperatorContext` + `buildSubagentDefs()`. This aligns with the SDK's native agent teams pattern and unlocks native Claude Code UI integration.

---

## 10. Technical Debt & Risks

### Production Breakage Risks
1. **SDK on `latest`** — upstream breaking change = instant breakage
2. **Non-atomic writes** — crash during session save = corruption
3. **No task cancellation** — dismissed operator keeps running + billing
4. **No maxConcurrent enforcement** — 100 spawned operators = 100 SDK connections

### User Frustration Points
1. **30s auto-deny on approvals** — too aggressive, users miss window
2. **Manual MCP setup** — editing settings.json is error-prone
3. **Session restore loses memory** — operator.memory[] not persisted
4. **TTS setup friction** — Piper requires manual binary download

### Security Concerns
1. **Localhost-only implicit trust** — no auth on MCP server
2. **Empty operatorId bypasses throttle** — approval gates circumventable
3. **No input validation on operatorId** — path injection risk in worktree names

### Architecture Decisions to Revisit
1. **Custom skill loader vs SDK native skills** — duplication
2. **Custom worktree manager vs SDK isolation** — duplication
3. **Custom approval queue vs MCP elicitation** — duplication
4. **Memory in OperatorContext.memory[] AND memoryStore** — dual systems

---

## 11. Recommended Next Session

**Build in this exact order:**

1. **Pin SDK versions + remove readline** (5 min)
2. **Fail fast on SDK import at startup** (15 min)
3. **Atomic writes for all persistence files** (1 hour) — extract shared `atomicWriteJSON()` helper
4. **Add AbortController to runOperator** (30 min)
5. **Validate operatorId + enforce maxConcurrent** (30 min)
6. **Model routing by role** (1 hour) — add `operator.modelByRole` config map
7. **Prompt caching architecture** (2 hours) — separate static/dynamic prompt
8. **SDK session resume** (30 min) — persist sessionId in snapshots
9. **Remove dead code** (30 min) — SSE broadcast, readline, dead config keys
10. **5 integration tests** (2 hours) — MCP startup, worktree, CLI, store consistency, approval timeout

**Total: ~1 day of focused work to reach production-quality MVP.**
