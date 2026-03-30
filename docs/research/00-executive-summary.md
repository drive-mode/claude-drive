# Claude-Drive: Executive Summary

> **Date:** 2026-03-26 | **Research Sprint:** 8 documents, 4,970 LOC analyzed

---

## Current State

- **What works:** Clean build (0 errors), 168 tests passing, functional MCP server on localhost:7891, full operator lifecycle (spawn/switch/dismiss/merge), typed memory system with auto-dream consolidation, hooks, skills, checkpoints, and 46 MCP tools. Windows-compatible for core functionality.
- **What's broken:** Non-atomic file writes (crash = corruption), no task cancellation (dismissed operators keep billing), SDK pinned to `latest` (upstream breakage risk), approval gates bypassable with empty operatorId, 7 of 12 hook events not wired.
- **What's missing:** Model routing by role ($24K–$30K/yr savings), prompt caching ($12K–$18K/yr), MCP channels for real-time events, native Claude Code skills integration, SDK session resume for operator persistence, mobile dashboard, plugin distribution.

---

## Platform Readiness

| Platform | Status | Key Blockers |
|----------|--------|-------------|
| Windows 11 | ⚠️ Mostly Ready | Worktree paths untested (260-char limit), hook shell execution needs `shell: true`, TTS system `say` unavailable |
| iOS | ❌ Not Started | No REST/SSE endpoints, no HTML dashboard. Quick win: ~330 LOC for basic mobile status page |
| macOS | ✅ Ready | Primary development platform, fully functional |
| Linux | ✅ Ready | All features work, `aplay` for TTS playback |

---

## Top 5 MVP Blockers (Ordered)

1. **Pin SDK versions** — `@anthropic-ai/claude-agent-sdk` and `@anthropic-ai/sdk` both on `latest`. One breaking upstream change = total failure.
2. **Atomic writes for persistence** — Sessions, checkpoints, config, and state files use non-atomic `writeFileSync`. Process crash during write = data corruption.
3. **Task cancellation via AbortController** — Dismissed operators continue running and billing indefinitely. No cancel signal passed to SDK.
4. **Fail fast on SDK import** — Currently lazy-loaded inside `runOperator()`. If SDK is missing, tasks silently abort with a console.error.
5. **Enforce maxConcurrent config** — `operators.maxConcurrent: 3` config key exists but is never checked. Unlimited operator spawning = API quota exhaustion.

---

## Cost Optimization Opportunity

**$64K–$90K/yr estimated savings** through:
- Model routing by role (Haiku for researchers, Opus for planners): $24K–$30K
- Prompt caching (static role template + ephemeral memory): $12K–$18K
- Batch API for non-urgent tasks: $8K–$12K
- Rate limit backpressure: $8K–$12K

---

## Ecosystem Integration Opportunity

claude-drive is **partially isolated** from Claude Code's native capabilities. Key integrations:
- **Agent Teams:** Map operators to native AgentDefinition → operators in Claude Code sidebar (CRITICAL)
- **MCP Channels:** Push events instead of `drive_get_state` polling (HIGH)
- **Elicitation:** Replace custom approval queue with native UI (HIGH)
- **Skills:** Register `/spawn`, `/operators`, `/costs` as Claude Code slash commands (HIGH)
- **Session Resume:** Persist sessionId → true operator persistence across restarts (HIGH)

---

## Recommended Next Session

**~1 day of focused work to reach production-quality MVP:**

1. Pin SDK versions + remove unused `readline` (5 min)
2. Fail fast on SDK import at startup (15 min)
3. Atomic writes for all persistence files (1 hour)
4. AbortController for task cancellation (30 min)
5. Validate operatorId + enforce maxConcurrent (30 min)
6. Model routing by role (1 hour)
7. Prompt caching architecture (2 hours)
8. SDK session resume (30 min)
9. Remove dead code (30 min)
10. 5 integration tests (2 hours)

---

## Research Documents

| Doc | Title | Key Finding |
|-----|-------|-------------|
| [01](01-build-health.md) | Build Health | A- grade. Clean build, 168 tests, SDK on `latest` is fragile |
| [02](02-operator-lifecycle.md) | Operator Lifecycle & SDK | Sound registry pattern. No task cancellation or mutex. |
| [03](03-mcp-tools.md) | MCP Server & Tools | 46 tools across 11 domains — consolidate to ~25. approval_request incomplete. |
| [04](04-infrastructure.md) | Infrastructure & Safety | 5 of 7 file types use non-atomic writes. Approval bypass via empty operatorId. |
| [05](05-tts-voice.md) | TTS & Voice | DEFER from MVP. Three backends, platform-fragmented. Clean disable available. |
| [06](06-test-coverage.md) | Test Coverage | 62% module coverage. 12 modules untested. No CI integration. |
| [07](07-ecosystem-fit.md) | Claude Code Ecosystem Fit | 12 integration opportunities. Agent Teams = the 10x moment. |
| [08](08-api-optimization.md) | API Cost Optimization | $64K–$90K/yr savings. Model routing + caching = 55% of total. |
| [09](09-vision-and-requirements.md) | Vision & Requirements | Full roadmap: P0 blockers → P1 stability → P2 features → P3 scale. |
