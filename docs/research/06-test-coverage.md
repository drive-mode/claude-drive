# 06 — Test Coverage & Code Quality

> **Auditor:** Claude Opus 4.6 | **Date:** 2026-03-26

---

## Test Inventory

| Test File | Source Module | Tests | Mocked | Quality |
|---|---|---|---|---|
| approvalGates.test.ts | approvalGates.ts | 36 | None | Real behavior — regex pattern matching |
| operatorManager.test.ts | operatorManager.ts | 18 | memoryStore singleton | Real behavior — prompt generation |
| operatorRegistry.test.ts | operatorRegistry.ts | 15 | None | Real behavior — lifecycle, events |
| statusLine.test.ts | statusLine.ts | 13 | None | Real behavior — bash script gen |
| memoryStore.test.ts | memoryStore.ts | 13 | None | Real behavior — CRUD + querying |
| driveMode.test.ts | driveMode.ts | 12 | store.js mocked | Mock-heavy — store mocked |
| skillLoader.test.ts | skillLoader.ts | 11 | None | Real behavior — registry + templates |
| statusFile.test.ts | statusFile.ts | 9 | None (real fs) | Real behavior — JSON persistence |
| router.test.ts | router.js | 9 | None | Real behavior — mode routing |
| hooks.test.ts | hooks.ts | 9 | None | Real behavior — registration + exec |
| config.test.ts | config.ts | 9 | Env vars | Real behavior — config resolution |
| planCostTracker.test.ts | planCostTracker.ts | 8 | None | Real behavior — cost state machine |
| autoDream.test.ts | autoDream.ts | 7 | memoryStore singleton | Real behavior — pruning/merging |
| mcpServer.test.ts | mcpServer.ts | 6 | None | **Trivial** — only path utilities |
| checkpoint.test.ts | checkpoint.ts | 4 | None (real fs) | Real behavior — checkpoint lifecycle |

**Totals:** 168 tests, 15 suites, all passing (2.38s)

---

## Coverage Gaps

### Zero Test Coverage (12 modules)

| Module | LOC | Risk | Missing Tests |
|---|---|---|---|
| **cli.ts** | ~400 | CRITICAL | Command dispatch, MCP startup, hook init, mode routing |
| **mcpServer.ts** | ~600 | CRITICAL | Tool registration, operator queries, skill execution, checkpoint restore |
| **worktreeManager.ts** | ~140 | HIGH | Allocation/release, branch creation, locking, concurrent access |
| **gitService.ts** | ~280 | HIGH | Git commands, error handling, ExecFn injection |
| **sessionManager.ts** | ~60 | MEDIUM | create/resume/list sessions, activity log |
| **sessionStore.ts** | ~100 | MEDIUM | save/load/delete, file I/O, serialization |
| **memoryManager.ts** | ~85 | MEDIUM | remember/recall/correct/forget/share |
| **approvalQueue.ts** | ~60 | MEDIUM | request/respond, auto-deny timeout |
| **store.ts** | ~52 | MEDIUM | JSON persistence, concurrent flush |
| **tts.ts** | ~150 | MEDIUM | speak/stop, backend switching |
| **edgeTts.ts** | ~100 | MEDIUM | TTS synthesis, stream handling |
| **piper.ts** | ~120 | MEDIUM | Local TTS, subprocess management |

### Critical Untested Paths

1. **MCP Server Startup** — `startMcpServer()` HTTP transport, ~25 tool registrations
2. **SDK Query Flow** — operator_query, memory_recall, skill_list integration
3. **CLI Command Dispatch** — `start|run|operator|tts|config` branches
4. **Worktree Operations** — Promise-chain lock, concurrent allocate, cleanup
5. **Hooks in MCP Context** — Hook execution when tools fire
6. **Git Service** — No actual git command execution tested
7. **Approval Queue** — Auto-deny timeout, EventEmitter flow

---

## Test Infrastructure

**Jest Config:**
- Preset: `ts-jest/presets/default-esm`
- Environment: `node`
- ESM support via `--experimental-vm-modules`
- Module mapping strips `.js` extensions for ESM interop
- **No coverage threshold configured**
- **No CI integration**

**Mocking Patterns:**
- `jest.unstable_mockModule()` for store mocking
- Singleton clearing (`memoryStore.getAll()` loop) between tests
- Real file I/O for statusFile and checkpoint tests
- `process.env` mutation for config overrides
- `makeOp()` helper for stub OperatorContext

**Shared Fixtures:** None — tests construct minimal objects inline

---

## Unix Philosophy Assessment

### Good: Testing Behavior
- ✅ approvalGates — tests pattern matching rules, not regex internals
- ✅ memoryStore — tests query semantics (kind, tags, search), not storage format
- ✅ router — tests keyword→mode mapping independently
- ✅ planCostTracker — tests state transitions, not timer internals

### Weak: Testing Implementation
- ⚠️ driveMode — mocks store to avoid I/O, only verifies mock calls
- ⚠️ statusLine — tests bash string content, not execution
- ⚠️ operatorManager — tests prompt substrings, not system behavior

### Mocks Hiding Bugs
- ⚠️ driveMode mock doesn't validate persistence actually works
- ⚠️ operatorManager doesn't test memory visibility in real prompts
- 🔴 No integration test between driveMode + store + statusFile

---

## MVP Test Priorities (Top 5)

| # | What to Test | Why | Approach | Files |
|---|---|---|---|---|
| **1** | MCP Server Init & Tool Registration | Zero observability into startup failures | Integration: `startMcpServer()`, verify HTTP binds, sample tool call | mcpServer, operatorRegistry, driveMode |
| **2** | Worktree Concurrent Allocate Safety | Promise-chain lock could race | Allocate twice concurrently, verify idempotency; mock GitService | worktreeManager, gitService |
| **3** | CLI Command Dispatch & Lifecycle | Entry point; silent failure = total breakage | Mock MCP startup, test each command, verify exit codes | cli, mcpServer, operatorRegistry |
| **4** | Store ↔ StatusFile Consistency | Hidden disagreement between state stores | setActive → verify store + statusFile agree | driveMode, store, statusFile |
| **5** | Approval Auto-Deny & Throttle | Timeout fires wrong decision if misordered | Mock clock, test 30s boundary, verify throttle at 3 blocks / 5 warns | approvalQueue, approvalGates |

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Test files | 15 |
| Total tests | 168 (all passing) |
| Test LOC | ~1,609 |
| Source LOC | ~3,500+ (27 modules) |
| Module coverage | 62% (15/27 tested) |
| Test density | 1 test per ~21 LOC |
| Coverage threshold | None configured |
| CI integration | None |

---

## Recommendations

1. **Add 5 high-priority integration tests** (priorities above) for MCP startup, worktree safety, CLI lifecycle
2. **Replace mock-heavy driveMode tests** with end-to-end: spawn → set mode → verify all systems agree
3. **Wire Jest coverage** into CI, set 70% threshold
4. **Create shared test fixtures** for operator creation, store initialization
5. **Add GitService integration tests** with isolated temp repo
