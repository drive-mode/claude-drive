# 01 — Build Health Audit

> **Auditor:** Claude Opus 4.6 | **Date:** 2026-03-26 | **Verdict:** A- (9.2/10)

---

## BUILD STATUS: PASSING

- **Compilation**: Clean (0 errors, 0 warnings). `npm run compile` succeeds.
- **Tests**: All 168 tests pass across 15 test suites (2.38s).
- **Pre-built CLI**: Functional. `node out/cli.js --help` responds correctly.

---

## Project Structure

**TypeScript Config:**
- Module system: ESM (NodeNext) — all relative imports require `.js` extensions
- Target: ES2022
- Strict mode enabled
- JSX: `react-jsx` (used in `tui.tsx` only)
- Output: `./out/`

**Total Source Code: ~4,970 LOC across 27 files**

---

## Dependencies & Versions

| Dependency | Version | Risk |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `latest` (v0.2.77) | **HIGH** — not pinned |
| `@anthropic-ai/sdk` | `latest` (v0.79.0) | **HIGH** — not pinned |
| `@modelcontextprotocol/sdk` | `^1.26.0` (v1.27.1) | Medium — semver |
| `edge-tts-universal` | `1.4.0` | Low — pinned |
| `say` | `0.16.0` | Low — pinned |
| `readline` | `1.3.0` | **Unused** — remove |

---

## File Audit: Line Counts & Responsibilities

| File | LOC | Responsibility | >200 LOC? | Unix Philosophy |
|------|-----|----------------|-----------|-----------------|
| mcpServer.ts | 684 | HTTP MCP server + all tool defs | **Yes** | Could modularize tools |
| cli.ts | 482 | CLI entry, all subcommands | **Yes** | Routing only (acceptable) |
| operatorRegistry.ts | 416 | Operator state machine | **Yes** | Single responsibility ✓ |
| checkpoint.ts | 246 | Session snapshots & forking | **Yes** | Focused, clean ✓ |
| skillLoader.ts | 232 | YAML parser + skill registry | **Yes** | Custom parser vs library |
| autoDream.ts | 220 | Memory consolidation daemon | **Yes** | Clear responsibilities ✓ |
| gitService.ts | 217 | Git command wrapper | **Yes** | Well-typed, testable ✓ |
| memoryStore.ts | 214 | Persistent typed memory | **Yes** | Clean design ✓ |
| operatorManager.ts | 208 | SDK query() + prompts | **Yes** | Good hook integration ✓ |
| statusLine.ts | 188 | Status line script gen | No | Bash-in-string (fragile) |
| hooks.ts | 182 | Hook registry + execution | No | Good event model ✓ |
| approvalGates.ts | 157 | Safety pattern matching | No | Well-structured ✓ |
| agentOutput.ts | 152 | Terminal output renderer | No | Clean ✓ |
| tts.ts | 151 | TTS abstraction layer | No | Three backends, well-structured ✓ |
| config.ts | 143 | Config loader (env > file > default) | No | Single responsibility ✓ |
| tui.tsx | 130 | Ink/React two-pane TUI | No | Clean ✓ |
| sessionStore.ts | 71 | Session JSON persistence | No | Clean ✓ |
| sessionManager.ts | 59 | Session create/resume | No | Clean ✓ |
| store.ts | 52 | JSON KV persistence | No | Minimal ✓ |
| memoryManager.ts | 85 | High-level memory ops | No | Clean ✓ |
| driveMode.ts | 82 | Drive state machine | No | Clean ✓ |
| planCostTracker.ts | 82 | Cost tracking per plan | No | Clean ✓ |
| statusFile.ts | 76 | Atomic status.json writes | No | Clean ✓ |
| edgeTts.ts | 74 | Edge TTS backend | No | Clean ✓ |
| piper.ts | 85 | Piper TTS backend | No | Clean ✓ |
| router.ts | 64 | Intent routing | No | Clean ✓ |
| approvalQueue.ts | 60 | Approval request queue | No | Clean ✓ |

---

## Import Analysis

- **All imports resolve** (verified by successful compilation)
- **ESM convention**: Strict `.js` extensions on all relative imports
- **`require()` in ESM** (4 instances): All justified — lazy loading or generated code
- **Circular dependencies**: None detected
- **Unused dependency**: `readline@1.3.0` — installed but never referenced

---

## SDK Availability

- **Installed**: v0.2.77
- **Importable**: Yes
- **Exports**: `query`, `forkSession`, `getSessionInfo`, `getSessionMessages`, `listSessions`, `createSdkMcpServer`, `tool`, etc.
- **Usage**: `query()` in operatorManager.ts

---

## Windows Compatibility

| File | Platform Code | win32 Handled? |
|------|--------------|----------------|
| edgeTts.ts:31-39 | Audio playback | ✓ (powershell) |
| piper.ts:48 | Process spawn shell | ✓ (shell=true) |
| piper.ts:75-82 | WAV playback | ✓ (powershell) |
| All path ops | `path.join()`, `os.homedir()` | ✓ |
| `~` expansion | `.replace(/^~/, os.homedir())` | ✓ |

**Assessment**: Windows-compatible. All platform-specific code properly gated.

---

## Dead Code

- **Unreachable code**: None
- **Unused exports**: None (all exports consumed by tests or MCP tools)
- **Unused dependency**: `readline` — can be removed

---

## TODO/FIXME/HACK Inventory

**None found.** Clean codebase with no flagged tech debt.

---

## Recommendations

| Priority | Action | Impact |
|----------|--------|--------|
| **P0** | Pin SDK versions (`latest` → exact) | Prevents breaking upstream changes |
| **P0** | Remove unused `readline` dependency | Reduces surface area |
| **P1** | Modularize `mcpServer.ts` (684 LOC) | Maintainability as tool count grows |
| **P1** | Use YAML library instead of custom parser | Robustness for skill files |
| **P2** | Add ESLint + Prettier | Code style consistency |
