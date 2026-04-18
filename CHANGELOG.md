# Changelog

## [Unreleased] — Code & Product Review (Stages 0–13)

A staged audit + refactor aimed at aligning the codebase with Unix principles.
All stages behaviour-preserving; public MCP tool names and CLI commands are
backwards-compatible.

### Stage 0 — Scripts & baseline

- Added `npm run lint` (tsc `--noEmit` with `noUnusedLocals`/`noUnusedParameters`).
- Added `npm run test:coverage`.
- Captured baseline metrics in `/opt/cursor/artifacts/coverage-baseline.md`.

### Stage 1 — Findings report

- Drafted 7-perspective review at `/opt/cursor/artifacts/review-findings.md`.

### Stage 2 — Paths seam

- `src/paths.ts` centralises every `~/.claude-drive/*` path.
- `CLAUDE_DRIVE_HOME` env var now overrides the home directory.
- 8 consumer modules migrated off inline `os.homedir()` composition.

### Stage 3 — Logger seam

- `src/logger.ts` with levels `debug|info|warn|error|silent`.
- Library-side `console.*` call sites: **26 → 0** (not counting the generated
  bash heredoc in `statusLine.ts`).
- Library logs land on stderr; stdout is reserved for user-facing + `--json`.

### Stage 4 — Zod-validated config

- `src/configSchema.ts` declares z-schemas for every known config key.
- Invalid file values are dropped at load with one aggregated stderr warning.
- `saveConfig` rejects invalid values (not persisted).

### Stage 5 — SDK test mock helper

- `tests/_helpers/sdkMock.ts` consolidates the `unstable_mockModule` pattern:
  `installSdkMock`, `makeQueryStream`, `typicalRun`, `resultMessage`.
- Refactored `progressEvents.test.ts`, `contextUsage.test.ts` to use it.

### Stage 6 — Module-scope `let` elimination

- 14 top-level `let` singletons reduced to 2 intentional cached singletons
  (the other is inside a bash heredoc). Encapsulated state in classes with
  `__resetForTests()` hooks.

### Stage 7 — Registry types extracted

- `src/registry/types.ts` and `src/registry/roles.ts` hold all type
  declarations + role templates.
- `src/operatorRegistry.ts` is now the class + name-pool helper only.
- Re-exported types from the canonical path so no caller changed.

### Stage 8 — SDK message narrowing

- `operatorManager.ts` now routes `SDKMessage` via control-flow narrowing
  on `type`/`subtype`. All `as unknown as {…}` casts removed.
- `as unknown` / `: any` in `operatorManager.ts`: **9 → 0**.

### Stage 9 — mcpServer split

- `src/mcp/server.ts` — HTTP/stdio transport + port file.
- `src/mcp/tools.ts` — all 53 tool registrations.
- `src/mcpServer.ts` is now a **16-line shim** re-exporting the public surface
  (down from 866 LoC).

### Stage 10 — CLI `--json` + stdout/stderr hygiene

- `--json` added to `operator list`, `mode status`, `agent list`,
  `session list`, `memory stats`, `memory list`.
- Each `--json` path emits a single valid JSON value; parse-asserted by
  `tests/cliJson.test.ts`.

### Stage 11 — MCP tool consolidation

- New canonical `agent_screen_log { kind, ... }` replaces the 5 per-kind
  tools. Legacy tools remain as debug-deprecated aliases.

### Stage 12 — Principles + docs

- `docs/PRINCIPLES.md` codifies the engineering conventions.
- This `CHANGELOG.md`.

### Stage 13 — Findings freeze

- `/opt/cursor/artifacts/review-findings.md` frozen with delta tables.

## Before this review

See the git history on the `cursor/claude-drive-agent-features-90b2` branch
for the preceding PR that upgraded the Agent SDK to 0.2.111, added the
agent-definition loader, best-of-N, and the progress-file system.
