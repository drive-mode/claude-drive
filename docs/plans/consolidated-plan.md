# claude-drive Consolidated Implementation Plan

**Date:** 2026-03-30
**Sources:** improvement-plan-v2.md + v0.2-roadmap.md
**Baseline:** 35 src files, 20 test suites, 244 tests, compiles clean

---

## Execution Waves

### Wave 1: Bug Fixes & Quick Wins (Parallel)

All items are independent — dispatch simultaneously.

| ID | Task | Source | Files | Effort |
|----|------|--------|-------|--------|
| W1-A | Fix TUI raw mode crash in non-interactive shells | 0.1 + A1 | tui.tsx, cli.ts | S |
| W1-B | Update deprecated model default (haiku) | A2 | config.ts, modelSelector.ts | XS |
| W1-C | Harden commsAgent for offline/keyless use | A3 | commsAgent.ts | S |
| W1-D | Add warnings to silent error catch blocks (5 locations) | 0.3 | tts.ts, commsAgent.ts, sessionManager.ts, approvalQueue.ts, tangentNameExtractor.ts | XS |
| W1-E | Add retry jitter to operatorManager backoff | 3.4 | operatorManager.ts | XS |
| W1-F | Remove co-author trailer from CONTRIBUTING.md | A4 | CONTRIBUTING.md | XS |
| W1-G | Update AGENTS.md with missing modules | A5 | AGENTS.md | S |

**Agent grouping (minimize file conflicts):**
- Agent 1 (TUI + Model): W1-A, W1-B
- Agent 2 (Error handling): W1-C, W1-D, W1-E
- Agent 3 (Docs): W1-F, W1-G

---

### Wave 2: Robustness & Infrastructure (Parallel after Wave 1)

| ID | Task | Source | Files | Effort |
|----|------|--------|-------|--------|
| W2-A | State persistence — checkpoint 5 systems on mutation, reload on startup | 0.2 | store.ts, operatorRegistry.ts, approvalQueue.ts, integrationQueue.ts, worktreeManager.ts | M |
| W2-B | Atomic file writes (writeJsonAtomic utility) | 1.1 | new fsUtils.ts, governance/scan.ts, syncLedger.ts | S |
| W2-C | Config schema + validation (Zod) | 1.4 | new configSchema.ts, config.ts | M |
| W2-D | Structured logging + log rotation | 1.5 + D4 | new logger.ts, cli.ts, agentOutput.ts | S |
| W2-E | Graceful shutdown — drain active operators | D5 | mcpServer.ts | S |

**Agent grouping:**
- Agent 4 (Persistence): W2-A, W2-B
- Agent 5 (Config + Logging): W2-C, W2-D
- Agent 6 (Shutdown): W2-E

---

### Wave 3: Test Coverage (Fully Parallel)

| ID | Priority | Modules | Source |
|----|----------|---------|--------|
| W3-A | High (security-critical) | approvalQueue, gitService, sessionManager, worktreeManager | B1 |
| W3-B | Medium (pipeline/utility) | tangentNameExtractor, tangentFlow, syncLedger, stateSyncCoordinator, integrationQueue | B2 |
| W3-C | Low (governance) | entropy, focusGuard, projectGraph, taskLedger, scan | B3 |

**Agent grouping:**
- Agent 7: W3-A (4 test files)
- Agent 8: W3-B (5 test files)
- Agent 9: W3-C (5 test files)

---

### Wave 4: Features (Dependencies noted)

| ID | Task | Source | Depends On | Effort |
|----|------|--------|------------|--------|
| W4-A | Operator completion tracking (Promise per operator, operator_await tool) | C3 | — | M |
| W4-B | Governance CLI subcommand (`claude-drive governance scan`) | 1.3 | — | XS |
| W4-C | Governance schema validation (Zod) | 1.2 | — | S |
| W4-D | Governance directory structure (standard layout) | 2.4 | — | XS |
| W4-E | Prompt optimizer (clean voice input before routing) | 2.1 | — | S |
| W4-F | Mode switcher validation (transition rules + semantic matching) | 2.2 | — | S |

**Agent grouping:**
- Agent 10 (Operator completion): W4-A
- Agent 11 (Governance): W4-B, W4-C, W4-D
- Agent 12 (Optimizer + Mode): W4-E, W4-F

---

### Deferred (v0.3+)

| Task | Source | Why Deferred |
|------|--------|--------------|
| Web dashboard (SSE) | 3.1 / C1 | Large, standalone — needs design first |
| DAG runner | C2 | Depends on W4-A (operator completion) |
| Voice input / STT | C4 | Large, needs Whisper binary/API |
| Operator memory persistence | C5 | Medium, can ship without |
| npm publish | C6 | Needs NPM_TOKEN secret |
| Cloud agent client | 4.1 | Needs multi-agent roadmap confirmation |
| Session accumulator | 2.5 | Medium, cursor-sdk port |
| Permission broker | 2.6 | Medium, cursor-sdk port |
| E2E lifecycle test | D2 | After completion tracking ships |
| Daemon mode | D3 | Nice-to-have |
| Memory full-text index | 3.6 | Optimization, not needed yet |
| Governance AI summary | 2.3 | Needs API key, low priority |
| Governance history viz | 3.3 | Polish |
| Snapshot caching | 3.5 | Optimization |
| Clarification handler | 3.2 | Polish |

---

## Worker Convention

```
Target: C:\Users\harri\Documents\Coding Projects\fun\ai-secretagent\drive-mode\claude-drive
ESM TypeScript, .js extensions on relative imports
Named exports only
Tests: Jest + ts-jest ESM (import { jest } from "@jest/globals")
No Co-Authored-By trailers
After changes: npm run compile && npm test (244+ tests must pass)
```

## Estimated Totals

| Wave | Items | Est. |
|------|-------|------|
| 1 | 7 | 3-4h |
| 2 | 5 | 6-8h |
| 3 | 14 test files | 6-10h |
| 4 | 6 | 8-12h |
| **Active** | **32** | **~25-35h** |
| Deferred | 15 | ~30-45h |
