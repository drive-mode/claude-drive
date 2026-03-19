# Plan: Consolidate and Ship claude-drive

## Context

There are two copies of `claude-drive`:

1. **`ai-secretagent/claude-drive/`** — the original scaffold (13 src files, 2 TS errors, missing worktrees/sessions/approval). This is where our worktree branch lives.
2. **`ai-secretagent/drive-mode/claude-drive/`** — the advanced version (19 src files, compiles cleanly, has worktrees, sessions, approval gates, TUI, 30+ MCP tools, 5 test files, router wired in).

**The `drive-mode` version is the winner.** It already implements everything the original plan proposed building from scratch. The real work is:

1. Consolidate into `drive-mode/claude-drive` as the canonical version
2. Run an integration shakedown to verify it actually works end-to-end
3. Fix any issues found during shakedown
4. Add missing test coverage for the new subsystems
5. Clean up the repo structure

## Key Files (drive-mode/claude-drive)

| Path | Status | Notes |
|------|--------|-------|
| `src/mcpServer.ts` | Complete | 30+ tools, port file, port range, stdio mode |
| `src/cli.ts` | Complete | 9 commands, router wired, TUI option |
| `src/worktreeManager.ts` | Complete | Mutex lock, idempotent, rollback |
| `src/sessionManager.ts` | Complete | Snapshot/resume with activity tracking |
| `src/sessionStore.ts` | Complete | JSON persistence at ~/.claude-drive/sessions/ |
| `src/approvalGates.ts` | Complete | Block/warn/log patterns, throttling |
| `src/approvalQueue.ts` | Complete | Promise-based queue with auto-deny timeout |
| `src/gitService.ts` | Complete | DI-ready, typed GitResult<T> |
| `src/tui.tsx` | Complete | Ink 5.0 two-pane layout |
| `src/operatorManager.ts` | Complete | Agent SDK query() with hooks |
| `src/operatorRegistry.ts` | Complete | Full lifecycle, hierarchies, events |
| `tests/*.test.ts` | 5 files | config, driveMode, mcpServer, operatorRegistry, router |

## Work Units

### Unit 1 — Consolidate repository structure
**Files:** repo-level
**Change:**
- Decide canonical location: either promote `drive-mode/claude-drive` to `ai-secretagent/claude-drive` (replacing the scaffold), or make `drive-mode/` the canonical monorepo location for both cursor-drive and claude-drive.
- If replacing: copy `drive-mode/claude-drive/*` over the current `ai-secretagent/claude-drive/`, preserving git history where possible.
- Update any cross-references, README links, CLAUDE.md paths.
**Decision needed from user:** Which location should be canonical?

### Unit 2 — End-to-end smoke test
**Files:** none (manual verification)
**Change:**
- `npm install && npm run compile` — verify clean build
- `npm test` — verify all 5 test files pass
- `node out/cli.js start` — verify MCP server starts, port file written
- `node out/cli.js port` — verify port discovery works
- `node out/cli.js start --tui` — verify TUI renders
- Test port range fallback: start two instances
- `node out/cli.js run "list files in this directory"` — verify Agent SDK integration
**Why:** It compiles, but we need to verify runtime behavior. Agent SDK calls, worktree creation, and MCP tool dispatch could fail at runtime.

### Unit 3 — Fix runtime issues found in smoke test
**Files:** TBD based on Unit 2 findings
**Change:** Fix whatever breaks during the smoke test. Common suspects:
- Agent SDK API changes (the `latest` dep pin is risky)
- MCP SDK transport API drift
- Git worktree commands on Windows (path separators, etc.)
- Ink rendering issues in certain terminal emulators
**Why:** Compilation success != runtime success, especially with `latest` deps.

### Unit 4 — Pin dependency versions
**Files:** `package.json`
**Change:**
- Replace `"latest"` pins for `@anthropic-ai/claude-agent-sdk` and `@anthropic-ai/sdk` with specific version numbers from the current `node_modules`.
- Keep semver ranges for stable deps (chalk, commander, zod, etc.).
**Why:** `"latest"` is a time bomb. Builds will break unpredictably when upstream publishes breaking changes.

### Unit 5 — Add integration tests for new subsystems
**Files:** `tests/worktreeManager.test.ts` (new), `tests/approvalGates.test.ts` (new), `tests/sessionManager.test.ts` (new), `tests/gitService.test.ts` (new)
**Change:**
- `gitService.test.ts`: Mock `ExecFn`, test worktreeAdd/Remove/List/mergeNoFf.
- `worktreeManager.test.ts`: Mock gitService, test allocate/release/cleanup.
- `approvalGates.test.ts`: Test block/warn/log pattern matching, throttle status.
- `sessionManager.test.ts`: Test snapshot/resume with mock registry.
**Why:** The 5 existing tests cover config/driveMode/registry/router/mcpServer. The new subsystems (git, worktrees, approval, sessions) have zero coverage.

### Unit 6 — Add MCP client integration test
**Files:** `tests/mcpIntegration.test.ts` (new)
**Change:**
- Start MCP server on random port.
- Connect with MCP client SDK.
- Call representative tools: `operator_spawn`, `drive_get_state`, `worktree_status`, `session_list`.
- Verify response shapes.
- Tear down.
**Why:** The existing `mcpServer.test.ts` likely tests tool registration, not actual HTTP round-trips.

### Unit 7 — Sync CLAUDE.md documentation
**Files:** `CLAUDE.md`, `.claude/CLAUDE.md`
**Change:**
- Update tool tables to reflect the actual 30+ tools.
- Add TUI documentation (`--tui` flag).
- Add stdio mode documentation (`serve-stdio`).
- Document approval gates config keys.
- Document session commands.
- Remove references to the old scaffold version.
**Why:** Documentation should match reality.

### Unit 8 — Clean up the old scaffold
**Files:** repo-level
**Change:**
- After consolidation is confirmed working, remove or archive the old `ai-secretagent/claude-drive/` scaffold (if it's now superseded).
- Update any CI, scripts, or symlinks that point to the old location.
**Why:** Two copies of the same project with different states is confusing and will lead to divergence.

## Execution Order

```
Unit 1 (consolidate) ──→ Unit 2 (smoke test) ──→ Unit 3 (fix issues) ──→ Unit 4 (pin deps)
                                                                              │
                                                        Unit 5 (subsystem tests) ←─┘
                                                        Unit 6 (MCP integration test)
                                                        Unit 7 (docs sync)
                                                        Unit 8 (cleanup)
```

## E2E Verification Recipe

1. `npm run compile` — zero errors
2. `npm test` — all tests pass (existing 5 + new ones from Units 5-6)
3. `node out/cli.js start` — server starts, `~/.claude-drive/port` written
4. `node out/cli.js port` — prints correct URL
5. `node out/cli.js start --tui` — TUI renders with activity + operator panes
6. In Claude Code with MCP configured:
   - `drive_get_state` returns valid JSON
   - `operator_spawn` creates operator
   - `drive_run_task` dispatches work via Agent SDK
   - `worktree_create` makes git worktree
   - `session_save` persists session
   - Kill + restart, `session_restore` — operators restored
7. `Ctrl+C` — port file deleted, clean exit

## Open Questions for User

1. **Canonical location:** Should `drive-mode/claude-drive` replace `ai-secretagent/claude-drive`, or should `drive-mode/` be the canonical home?
2. **Scope of "comprehensive":** The drive-mode version is already feature-complete. Do you want to add anything beyond what's there (e.g., web UI, voice input, more cursor-drive ports)?
3. **cursor-drive sync:** cursor-drive has 49 files vs claude-drive's 19. Some of those (cloudAgentClient, commsAgent, tangentFlow, snapshotFeed, etc.) may be worth porting. Which, if any, are priorities?
