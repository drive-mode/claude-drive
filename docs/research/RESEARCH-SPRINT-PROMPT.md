# Claude-Drive Research & Discovery Sprint

> **Executor:** Claude Opus 4.6 (1M context)
> **Repository:** `/home/user/claude-drive`
> **Built with:** `@anthropic-ai/claude-agent-sdk`
> **Design philosophy:** Unix — do one thing well, compose small tools, text as interface
> **Platform priority:** (1) Windows 11 desktop, (2) iOS low-hanging fruit, (3) macOS/Linux

---

## How to Run This Sprint

Paste this entire document as your prompt in a fresh Claude Code session pointed at the claude-drive repository. Claude will execute all phases using TodoWrite, Agent (foreground/background), and file writes to produce 8 research documents in `docs/research/`.

---

## Design Philosophy: Unix Principles as Review Criteria

Every file and function in the codebase must be evaluated against these criteria. Agents should **flag violations** and **recommend removals or refactors**:

| Principle | Test to Apply |
|-----------|--------------|
| **Do one thing well** | Does this module have a single, clear responsibility? If you can't describe it in one sentence, it's doing too much. |
| **Compose through interfaces** | Does this module accept input and produce output that other tools can consume? Or is it a monolith? |
| **Text as universal interface** | Are data structures JSON-serializable? Could another process consume this module's output? |
| **Small is beautiful** | Is every line earning its place? Flag any file >200 LOC — it probably does too much. |
| **Fail fast and loud** | Does the code fail explicitly with useful errors? Or does it silently swallow problems? |
| **No premature abstraction** | Is there abstraction without multiple consumers? Flag helpers/utilities used exactly once. |
| **No dead code** | Flag every unused export, unreachable branch, config key read but never set (or vice versa). |
| **Explicit over clever** | Flag any "magic" — implicit behavior, hidden side effects, non-obvious defaults. |

---

## Claude Agent SDK Context

claude-drive uses `@anthropic-ai/claude-agent-sdk` to run operators as subagents. Research agents must understand:
- How `query()` is called — parameters, hooks, streaming
- How subagent definitions are built and composed
- How tool permissions map to SDK's `allowedTools`
- How cost/usage data is extracted from SDK responses
- Whether the SDK integration follows best practices or has anti-patterns
- Whether claude-drive could itself be restructured as composable Agent SDK agents

---

## Phase 1: Build Health & Runtime Verification

### TodoWrite — Create initial tracking

```json
[
  {"content": "Phase 1: Verify build health & runtime", "status": "in_progress", "activeForm": "Verifying build health & runtime"},
  {"content": "Phase 2: Launch parallel domain research agents", "status": "pending", "activeForm": "Launching domain research agents"},
  {"content": "Phase 3: Synthesize findings into vision document", "status": "pending", "activeForm": "Synthesizing findings into vision document"},
  {"content": "Phase 4: Produce executive summary & next steps", "status": "pending", "activeForm": "Producing executive summary"}
]
```

### Agent: "Build Doctor" (FOREGROUND — blocking, must complete before Phase 2)

```
Tool: Agent
subagent_type: "Explore"
description: "Verify build health"
```

**Prompt:**

> You are performing a build health audit of claude-drive at `/home/user/claude-drive`. RESEARCH ONLY — do not edit files.
>
> **Execute in order:**
>
> 1. **Read `tsconfig.json` and `package.json` completely.** Note TypeScript version, module system (ESM/CJS), target, all dependencies with versions. Check if `@anthropic-ai/claude-agent-sdk` version is pinned or `latest`.
>
> 2. **Run `npm run compile`** — capture ALL errors. Categorize: missing types, import resolution, ESM issues, type errors.
>
> 3. **Run `npm test`** — capture all results. Note which tests pass/fail and why.
>
> 4. **Check pre-built `out/` directory** — run `node out/cli.js --help`. Is the old build functional?
>
> 5. **Full directory audit.** Run `find src/ -name '*.ts' -o -name '*.tsx'` and for EVERY file:
>    - Read it completely
>    - Count lines of code (flag any file >200 LOC)
>    - List all imports — flag any that resolve to nonexistent files
>    - List all exports — flag any that are never imported elsewhere
>    - Flag any `require()` calls in ESM context
>    - List ALL `TODO`, `FIXME`, `HACK`, `XXX` comments with file:line
>    - Flag Unix-specific code: hardcoded `/tmp`, `~/`, shell commands (`afplay`, `aplay`, `sh -c`), path separators
>    - Apply Unix philosophy: does this file do one thing? Is every line earning its place?
>
> 6. **Check SDK availability:** `node -e "import('@anthropic-ai/claude-agent-sdk').then(m => console.log(Object.keys(m))).catch(e => console.error(e.message))"`
>
> 7. **Check all config/scripts/dot files:** `.claude/`, `CLAUDE.md`, `.github/`, `jest.config*`, `.eslintrc*`, `.prettierrc*`
>
> **Output structured report:**
> - BUILD: compiles? error count and categories
> - TESTS: pass/fail counts, failure reasons
> - PRE-BUILT: usable? version?
> - FILE AUDIT: per-file line count, responsibility, Unix philosophy violations
> - IMPORTS: broken imports, circular dependencies, unused exports
> - SDK: installed? importable? version? API surface?
> - WINDOWS: per-file compatibility issues
> - DEAD CODE: unused exports, unreachable branches, dead config
> - TODO INVENTORY: every TODO/FIXME with file:line

**After this agent returns:** Read the output. Note critical blockers. Save findings to `docs/research/01-build-health.md` using the Write tool.

---

## Phase 2: Parallel Domain Deep-Dives (5 background agents)

### TodoWrite — Update tracking

Mark Phase 1 completed. Add per-agent sub-tasks. Set Phase 2 in_progress.

### Launch ALL 5 agents in ONE message (5 parallel Agent tool calls, all `run_in_background: true`)

**CRITICAL: Send all 5 Agent calls in a single response. Do not launch them sequentially.**

---

### Agent 2: "Operator Lifecycle & SDK Integration" (BACKGROUND)

```
Tool: Agent
subagent_type: "Explore"
run_in_background: true
description: "Research operator lifecycle"
```

**Prompt:**

> Research the operator lifecycle and Agent SDK integration in claude-drive at `/home/user/claude-drive`. RESEARCH ONLY.
>
> **Read completely, line by line:**
> - `src/operatorRegistry.ts`
> - `src/operatorManager.ts`
> - `src/driveMode.ts`
> - `src/router.ts`
>
> **For each file, apply Unix philosophy review:**
> - Single responsibility? If >200 LOC, what should be extracted?
> - Clean interfaces? Could another tool consume its output?
> - Dead code? Unused exports? Premature abstractions?
> - Fail fast? Silent error swallowing?
>
> **Answer with code references (file:line):**
>
> 1. **OPERATOR STATE MACHINE** — All states, transitions, and the complete lifecycle diagram (spawn → active → paused → dismissed/merged). Required vs optional spawn parameters. What resources are created/destroyed at each transition.
>
> 2. **ROLE SYSTEM** — Every role template (implementer, reviewer, tester, researcher, planner) with exact configuration: system prompt additions, tool access, default behavior. Permission presets (readonly/standard/full) with exact tool lists. Visibility modes (isolated/shared/collaborative) with behavioral differences.
>
> 3. **AGENT SDK INTEGRATION** — Full trace: task input → operatorManager → SDK `query()` call → streaming response → result extraction. Every parameter passed to `query()` with types. Subagent definitions: what exists, how composed. Cost extraction: where in SDK response, data format. Hooks: PostToolUse and others, what they track. Error paths: SDK missing, rate limits, timeouts, network failures.
>
> 4. **DRIVE MODE** — All subModes with descriptions. How mode affects operator system prompts and tool access. Router keyword matching logic and precedence. Persistence across restarts.
>
> 5. **COMPOSABILITY ASSESSMENT** — Could operators be restructured as standalone Agent SDK agents that compose? Is the registry pattern the right abstraction or is it fighting the SDK's design? Could the whole system be simpler?
>
> 6. **WINDOWS 11** — Path separators, process spawning, shell assumptions in these files.
>
> 7. **GAPS & RISKS** — Dead code paths, race conditions, hardcoded values, scalability at 5+ operators.

---

### Agent 3: "MCP Server & Tool Surface" (BACKGROUND)

```
Tool: Agent
subagent_type: "Explore"
run_in_background: true
description: "Research MCP tools"
```

**Prompt:**

> Research the MCP server and tool surface in claude-drive at `/home/user/claude-drive`. RESEARCH ONLY.
>
> **Read completely:**
> - `src/mcpServer.ts`
> - `src/agentOutput.ts`
> - `src/statusFile.ts`
> - `src/statusLine.ts`
> - `src/planCostTracker.ts`
>
> **Unix philosophy review per file:** Single responsibility? File size justified? Dead code? Premature abstraction?
>
> **Produce:**
>
> 1. **COMPLETE TOOL CATALOG** — For EVERY MCP tool in mcpServer.ts:
>    | Tool Name | Parameters (types) | Implementation (what runs) | Status (complete/partial/stub) | Verdict (keep/merge/remove) |
>    Justify every "remove" with Unix philosophy reasoning.
>
> 2. **SERVER ARCHITECTURE** — HTTP binding (host, port, fallback). Session management lifecycle. stdio vs HTTP transport and when each is used. Multi-client behavior. Auth/CORS status. Port file lifecycle.
>
> 3. **EVENT SYSTEM** — All event types with fields. SSE broadcast: is `setSseBroadcast()` wired up or dead code? "web" mode: implemented or aspirational? TUI integration path.
>
> 4. **STATUS & COST** — Status file schema, write frequency, consumers. Status line: Claude Code integration, data rendered. Plan cost tracker: period lifecycle.
>
> 5. **TOOL SURFACE CRITIQUE** — Are there too many tools? Which tools are never called by Claude Code in practice? Could tools be consolidated following Unix philosophy (fewer tools, richer composition)? What's the minimal tool surface for MVP?
>
> 6. **MOBILE / iOS INTERFACE POINTS** — What existing endpoints could serve a mobile client? What's the minimum change to expose an activity feed to a phone browser? Could the MCP server serve a simple HTML page alongside MCP? SSE as mobile event source?

---

### Agent 4: "Infrastructure & Safety" (BACKGROUND)

```
Tool: Agent
subagent_type: "Explore"
run_in_background: true
description: "Research infrastructure"
```

**Prompt:**

> Research infrastructure and safety systems in claude-drive at `/home/user/claude-drive`. RESEARCH ONLY.
>
> **Read completely:**
> - `src/worktreeManager.ts`
> - `src/gitService.ts`
> - `src/sessionManager.ts`
> - `src/sessionStore.ts`
> - `src/approvalGates.ts`
> - `src/approvalQueue.ts`
> - `src/config.ts`
> - `src/store.ts`
>
> **Unix philosophy review per file.** These are infrastructure — they MUST be rock solid. Flag anything that could corrupt state or lose data.
>
> **Answer:**
>
> 1. **GIT WORKTREE** — Allocation flow, branch naming, merge flow, conflict handling, orphan cleanup, concurrency safety. Windows: does `git worktree` work identically on Windows?
>
> 2. **SESSIONS** — Snapshot schema (exact fields), survival across restart, restore flow (what's recreated vs lost), storage format and location.
>
> 3. **APPROVAL GATES** — Every default pattern (block/warn/log) listed with regex. Auto-throttle: exact thresholds and behavior. Queue: request/response flow, timeout, MCP tool integration. Security: could an operator bypass approval gates?
>
> 4. **CONFIG SYSTEM** — COMPLETE key inventory:
>    | Key | Type | Default | Description | Actually Used? (grep for consumers) |
>    Priority chain with exact logic. Env var mapping rules. Dead config keys.
>
> 5. **PERSISTENCE** — Every file written to `~/.claude-drive/` with purpose and format. Crash recovery behavior. Atomic write usage. Windows path compatibility (`~` expansion, path separators).
>
> 6. **COMPLEXITY AUDIT** — For each file: is the abstraction justified? Could config.ts be simpler? Is store.ts over-engineered for a JSON file? Is sessionStore.ts redundant with store.ts?

---

### Agent 5: "TTS & Voice" (BACKGROUND)

```
Tool: Agent
subagent_type: "Explore"
run_in_background: true
description: "Research TTS system"
```

**Prompt:**

> Research TTS and voice in claude-drive at `/home/user/claude-drive`. RESEARCH ONLY.
>
> **Read completely:** `src/tts.ts`, `src/edgeTts.ts`, `src/piper.ts`
>
> **Unix philosophy:** TTS is a nice-to-have feature. Is it over-engineered for MVP? Could it be a separate optional package?
>
> **Produce platform compatibility matrix:**
>
> | Capability | macOS | Linux | Windows 11 | iOS (web audio) |
> |------------|-------|-------|------------|----------------|
> | Edge TTS | ? | ? | ? | ? |
> | Piper | ? | ? | ? | ? |
> | System say | ? | ? | ? | ? |
> | Audio playback cmd | afplay | aplay | ? | Web Audio API? |
>
> **Per backend:**
> - Edge TTS: free/paid? Internet required? Rate limits? Default voice? Playback command per platform? Windows: what plays WAV files?
> - Piper: binary source? Auto-download? Model files? Windows binary available?
> - System say: macOS=`say`, Linux=`espeak`?, Windows=`PowerShell [System.Speech]`?
>
> **Features:** Sentence truncation logic, spoken history purpose, interruption tracking, async behavior (blocks event loop?).
>
> **Verdict:** Should TTS ship in MVP or be deferred? If deferred, how cleanly can it be disabled?

---

### Agent 6: "Test Coverage & Code Quality" (BACKGROUND)

```
Tool: Agent
subagent_type: "Explore"
run_in_background: true
description: "Research test coverage"
```

**Prompt:**

> Analyze test coverage and quality in claude-drive at `/home/user/claude-drive`. RESEARCH ONLY.
>
> **Read ALL test files** (`**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/*`) and Jest config.
>
> **Produce:**
>
> 1. **TEST INVENTORY**
>    | Test File | Source Module | Test Count | What's Mocked | Quality (real behavior / mock-heavy / trivial) |
>
> 2. **COVERAGE GAPS** — Source files with zero coverage. Critical untested paths (MCP startup, SDK query, CLI commands, worktree operations).
>
> 3. **TEST INFRA** — Jest config (ESM support, transforms). Shared mocks/fixtures. CI workflow integration.
>
> 4. **UNIX PHILOSOPHY ON TESTS** — Are tests testing behavior or implementation details? Are mocks hiding real bugs? Could integration tests replace 5 unit tests?
>
> 5. **MVP TEST PRIORITIES** — Top 5 tests to write ranked by risk reduction:
>    | Priority | What to Test | Why | Approach | Files Involved |

---

## Phase 3: Collect, Save, and Synthesize

**As each background agent completes** (you'll receive notifications):

1. **TodoWrite** — Mark that agent's research task as `completed`
2. **Write** — Save findings to the corresponding file:
   - `docs/research/02-operator-lifecycle.md`
   - `docs/research/03-mcp-tools.md`
   - `docs/research/04-infrastructure.md`
   - `docs/research/05-tts-voice.md`
   - `docs/research/06-test-coverage.md`

**Once ALL 5 background agents have completed**, proceed to synthesis.

### Agent 7: "Product Synthesizer" (FOREGROUND — blocking)

```
Tool: Agent
subagent_type: "Plan"
description: "Synthesize vision doc"
```

**Prompt:**

> You are a product analyst. Read ALL research documents in `docs/research/` (files 01 through 06) at `/home/user/claude-drive/docs/research/`.
>
> claude-drive is built with `@anthropic-ai/claude-agent-sdk` and follows Unix design philosophy. Target platforms: Windows 11 (primary), iOS (low-hanging fruit), macOS/Linux (secondary).
>
> **Produce `docs/research/07-vision-and-requirements.md` with:**
>
> 1. **PRODUCT VISION** — One-paragraph description. Target user. Value prop vs Claude Code alone. The "10x moment."
>
> 2. **UNIX PHILOSOPHY SCORECARD** — Rate the codebase 1-5 on each principle (do one thing, compose, text interface, small, fail fast, no premature abstraction, no dead code, explicit). Overall grade. Top 3 refactors that would improve the score.
>
> 3. **FEATURE MATURITY MATRIX**
>    | Feature | Status | Windows 11 | iOS | Notes |
>    Rate each: Not Started / Stubbed / Partial / Complete / Tested
>
> 4. **MVP DEFINITION — WINDOWS 11**
>    For each step (install → start → connect → use → merge), list:
>    - Current state (works / broken / untested)
>    - Specific blockers with file:line references
>    - Estimated fix complexity (trivial / moderate / significant)
>
> 5. **iOS QUICK WINS**
>    What can be built in 1-2 days using existing infrastructure:
>    - Read-only activity feed via SSE?
>    - Status page served by MCP server?
>    - Mobile-friendly approval interface?
>
> 6. **ROADMAP**
>    - **P0** (MVP blockers): itemized with file references and dependencies
>    - **P1** (first week): stability and quality of life
>    - **P2** (first month): compelling features
>    - **P3** (future): iOS native, web dashboard, team features
>
> 7. **AGENT SDK ARCHITECTURE REVIEW**
>    - Is claude-drive using the SDK idiomatically?
>    - Could the operator/registry pattern be simplified using SDK primitives?
>    - Should claude-drive itself be decomposable into SDK agents?
>
> 8. **TECHNICAL DEBT & RISKS** — Production breakage risks, user frustration points, security concerns, architecture decisions to revisit.
>
> 9. **RECOMMENDED NEXT SESSION** — Exactly what to build first, in what order, with estimated scope.

**Save output to `docs/research/07-vision-and-requirements.md`.**

---

## Phase 4: Executive Summary

### TodoWrite — Mark all tasks completed.

### Write `docs/research/00-executive-summary.md`

Compose a 1-page executive summary:

```markdown
# Claude-Drive: Executive Summary

## Current State
- [3 bullet points: what works, what's broken, what's missing]

## Platform Readiness
| Platform | Status | Blockers |
|----------|--------|----------|
| Windows 11 | ? | ? |
| iOS | ? | ? |
| macOS | ? | ? |
| Linux | ? | ? |

## Top 5 MVP Blockers (ordered)
1. ...

## Recommended Next Session
[Exactly what to build, in what order]

## Research Documents
- 01-build-health.md
- 02-operator-lifecycle.md
- 03-mcp-tools.md
- 04-infrastructure.md
- 05-tts-voice.md
- 06-test-coverage.md
- 07-vision-and-requirements.md
```

Present this summary to the user as your final message.

---

## Verification Checklist

Before declaring the sprint complete:

- [ ] Every `src/*.ts` and `src/*.tsx` file read by at least one agent
- [ ] Every MCP tool cataloged with implementation status and keep/remove verdict
- [ ] Every config key documented with default, type, and whether it's actually used
- [ ] Build/test status definitively known with specific error list
- [ ] Unix philosophy violations cataloged per-file with refactor recommendations
- [ ] Agent SDK usage reviewed for idiomatic patterns vs anti-patterns
- [ ] Windows 11 compatibility issues listed per-file
- [ ] iOS quick-win opportunities identified with effort estimates
- [ ] All 8 research documents saved to `docs/research/`
- [ ] Clear, ordered "what to build next" list exists
- [ ] TodoWrite shows all tasks completed
