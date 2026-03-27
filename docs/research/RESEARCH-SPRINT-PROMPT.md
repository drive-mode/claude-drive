# Claude-Drive Research & Discovery Sprint

> **Executor:** Claude Opus 4.6 (1M context)
> **Repository:** `/home/user/claude-drive`
> **Built with:** `@anthropic-ai/claude-agent-sdk`
> **Design philosophy:** Unix — do one thing well, compose small tools, text as interface
> **Platform priority:** (1) Windows 11 desktop, (2) iOS low-hanging fruit, (3) macOS/Linux
> **Sprint duration:** ~45–60 min wall-clock with parallel agents. The sprint launches 7+ agents that produce 8 docs — expect long-running background work. Don't abandon thinking it's stuck.

---

## Prerequisites

Before running the sprint, verify:

- [ ] `npm install` completed
- [ ] `out/` directory exists (run `npm run compile` first if not)
- [ ] Git working tree is clean (the sprint writes to `docs/` — dirty state may confuse agents)
- [ ] Sufficient API credits for 7 agent invocations (Opus 4.6 × ~50k tokens each)

---

## How to Run This Sprint

Paste this entire document as your prompt in a fresh Claude Code session pointed at the claude-drive repository. Claude will execute all phases using TodoWrite, Agent (foreground/background), and file writes to produce 10 research documents in `docs/research/`.

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
| **Pipe-friendly** | Could this module's output be piped to another tool? Does it emit structured (JSON) output on stdout and errors on stderr? |

<!-- TODO: Consider a scoring rubric (1-5 per principle per file) so agents produce
     machine-readable scores, not just prose. Makes Phase 3 synthesis deterministic
     instead of subjective. Could output a `scores.json` alongside the markdown. -->

---

## Claude Agent SDK Context

claude-drive uses `@anthropic-ai/claude-agent-sdk` to run operators as subagents. Research agents must understand **all** SDK capabilities and evaluate whether claude-drive is leveraging them:

### Core SDK Features to Audit
- **`query()` parameters** — prompt, options, streaming (`includePartialMessages`), session management (`continue`, `resume`, `forkSession`)
- **Subagent definitions** — `AgentDefinition` with `description`, `prompt`, `tools`, `model`. Can operators be defined this way?
- **Custom tools** — `@tool` decorator / `tool()` helper with in-process MCP server (`createSdkMcpServer()`). Tool annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`
- **Tool permissions** — `allowedTools`, `disallowedTools`, `tools` array, `canUseTool` callback, permission modes (`default`/`dontAsk`/`acceptEdits`/`bypassPermissions`/`plan`)
- **Hooks** — `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `PreCompact`, `PermissionRequest`, `Notification` with matchers and async support
- **Session management** — `resume: sessionId` for cross-restart persistence, `forkSession` for alternatives, `ClaudeSDKClient` (Python) for multi-call sessions
- **Cost tracking** — `ResultMessage.total_cost_usd`, per-model `modelUsage` map (TS), `cache_read_input_tokens` / `cache_creation_input_tokens`
- **Streaming** — `StreamEvent` messages with `text_delta`, `input_json_delta` for real-time UI. Incompatible with extended thinking.
- **Structured outputs** — JSON Schema / Zod / Pydantic for deterministic operator responses
- **Extended thinking** — `maxThinkingTokens` for complex reasoning, adaptive thinking (Opus 4.6)
- **Tool search** — automatic for 10+ tools, withholds definitions from context until needed
- **Plugins** — programmatically add commands, agents, MCP servers to sessions at runtime
- **File checkpointing** — snapshot and revert file changes across sessions

### Claude Code Integration Points to Audit
- **MCP channels** — bidirectional push communication (research preview). Could replace polling `drive_get_state`.
- **Skills** — `.claude/skills/<name>/SKILL.md` with frontmatter. Could expose `/spawn`, `/operators`, `/costs` as slash commands.
- **Plugins** — bundle skills, agents, hooks, MCP servers. Could claude-drive ship as a plugin?
- **Agent teams** — parallel teammates with `TaskCreate`/`TaskCompleted`/`TeammateIdle` hooks. Competition or composition with operators?
- **Elicitation** — MCP servers request user input inline during tool calls. Could replace approval queue.
- **Hooks (Claude Code side)** — 18+ event types. Which should claude-drive consume or register?
- **Status line** — custom command-based, receives model/cost/context/worktree data. Already partially integrated.
- **Native worktrees** — `--worktree` flag, `isolation: worktree` in agent config, `WorktreeCreate`/`WorktreeRemove` hooks.
- **Session transcripts** — `.jsonl` files at `~/.claude/projects/{project}/subagents/`. Could enable operator memory across restarts.

### Claude API Features to Audit
- **Prompt caching** — `cache_control: {"type": "ephemeral"}` with 5-min or 1-hour TTL. Cache hits cost 0.1x (90% savings). Are operator system prompts cached?
- **Model routing** — Opus ($25/MTok) for complex planning, Sonnet ($15/MTok) for balanced work, Haiku ($5/MTok) for fast routing. Does claude-drive auto-select?
- **Extended thinking** — `budget_tokens` for deep reasoning. Interleaved thinking with tool use (beta).
- **Batch API** — 50% cost reduction for async operations. Could background operators use batching?
- **Token counting** — free endpoint to estimate costs before dispatching.
- **Structured outputs** — JSON schema enforcement for deterministic responses. Are operator outputs validated?
- **Rate limit awareness** — `anthropic-ratelimit-*-remaining` headers. Cache-aware ITPM: only uncached tokens count. Backpressure?
- **Fast mode** — `speed: "fast"` (Opus 4.6 beta) for lower-latency responses on simple tasks.
- **Citations** — document grounding with source tracking. Could operators cite code references?
- **Files API** — upload once, reference by `file_id`. Efficient for repeated large contexts.

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

<!-- TODO: The Build Doctor should also check for security basics:
     - Are there any hardcoded secrets/tokens in source?
     - Does the MCP server bind to 0.0.0.0 or 127.0.0.1? (critical for safety)
     - Are npm audit vulnerabilities present?
     - Is there a lockfile (package-lock.json) committed?
     These are table-stakes for a network-facing daemon. -->

<!-- TODO: Add a "Dependency Weight" audit step — run `du -sh node_modules/` and list
     the top 10 heaviest deps. For a CLI tool, startup time matters. Consider whether
     `ink` (React for terminal) is pulling in too much for what amounts to a status line. -->

**After this agent returns:** Read the output. Note critical blockers. Save findings to `docs/research/01-build-health.md` using the Write tool.

---

## Phase 2: Parallel Domain Deep-Dives (7 background agents)

### TodoWrite — Update tracking

Mark Phase 1 completed. Add per-agent sub-tasks (Agents 2-8). Set Phase 2 in_progress.

### Launch ALL 7 agents in ONE message (7 parallel Agent tool calls, all `run_in_background: true`)

**CRITICAL: Send all 7 Agent calls in a single response. Do not launch them sequentially.**

<!-- TODO: Consider adding a "Dogfooding" agent that actually tries to USE claude-drive
     to perform a small task (e.g., "add a comment to store.ts") and reports the UX
     friction. Research-only agents miss the actual user experience. Even a dry-run
     trace of `node out/cli.js run "add a comment"` would be invaluable. -->

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

<!-- TODO: Add an 8th research question to Agent 2:
     "8. **OPERATOR COMMUNICATION** — Can operators share context today? Could operator A
     ask operator B a question? Is there a message bus or shared memory? Multi-operator
     is the killer feature — if operators can't collaborate, they're just parallel
     single agents. Research what cursor-drive does here and what claude-drive is missing." -->

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

<!-- TODO: Agent 3 should also investigate MCP protocol compliance:
     - Does the server implement the full MCP spec (initialize, list_tools, call_tool)?
     - Are tool schemas valid JSON Schema with proper descriptions?
     - Could this server be tested with `mcp-inspector` or similar?
     - Are error responses MCP-compliant or custom?
     Protocol compliance bugs are invisible until a different client connects. -->

<!-- TODO: Research the MCP Streamable HTTP transport (replacing SSE) that shipped in
     MCP spec 2025-03. If claude-drive is still on the old SSE transport, that's a
     migration to plan. Claude Code may deprecate the old transport. -->

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

<!-- TODO: Agent 4 should specifically audit the approval gates for bypasses:
     "7. **ADVERSARIAL REVIEW** — If a rogue operator prompt-injects itself, can it:
     (a) bypass approval gates by calling internal functions directly,
     (b) read/write files outside its worktree,
     (c) spawn additional operators,
     (d) modify its own permission preset?
     This is THE security question for multi-agent systems." -->

<!-- TODO: Research whether worktree isolation is sufficient or if operators should
     run in actual sandboxes (containers, nsjail, landlock). Git worktrees share
     the same .git directory — a malicious operator could `git config` its way
     to code execution via hooks. Flag this as a known limitation. -->

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

<!-- TODO: TTS agent should also explore Web Speech API as a fourth backend.
     If the iOS quick-win is a browser-based activity feed, the browser's
     built-in speechSynthesis API is zero-dependency TTS for mobile. This
     flips the architecture: instead of server-side TTS piped to speakers,
     the server sends text and the client speaks it. Much simpler for mobile. -->

<!-- TODO: Research whether TTS could be extracted to its own npm package
     (`@claude-drive/tts` or similar) that claude-drive depends on optionally.
     This is the Unix philosophy applied at the package level — separate
     concerns into composable packages. Also unblocks other CLI tools that
     want voice output. -->

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

<!-- TODO: Agent 6 should also evaluate whether the test suite can run on CI:
     - Are there tests that need a running MCP server or network access?
     - Do any tests depend on ~/.claude-drive/ existing?
     - Is there a GitHub Actions workflow? If not, spec one.
     - Could tests run in the claude-code web sandbox (no network, no git)?
     CI-readiness is a prerequisite for safe merges and npm publishing. -->

<!-- TODO: Add a "Property-Based Testing" recommendation section. Multi-operator
     state machines are perfect candidates for property-based tests (fast-check):
     "for any sequence of spawn/switch/dismiss operations, the registry never
     enters an invalid state." This catches edge cases unit tests miss. -->

---

### Agent 7: "Claude Code Ecosystem Fit" (BACKGROUND)

```
Tool: Agent
subagent_type: "Explore"
run_in_background: true
description: "Research ecosystem integration"
```

**Prompt:**

> Research how claude-drive at `/home/user/claude-drive` integrates with — and could better leverage — the Claude Code ecosystem. RESEARCH ONLY.
>
> **Read completely:**
> - `src/mcpServer.ts` (MCP server — the integration surface)
> - `src/cli.ts` (CLI entry, stdio transport)
> - `src/operatorManager.ts` (SDK query calls)
> - `src/operatorRegistry.ts` (operator lifecycle)
> - `src/approvalQueue.ts` (approval flow)
> - `src/statusLine.ts` and `src/statusFile.ts` (status integration)
> - `src/sessionManager.ts` (session persistence)
> - `src/worktreeManager.ts` (git worktree isolation)
>
> **For each Claude Code feature below, answer:**
> - (a) Is claude-drive **duplicating** native functionality? If so, should it delegate?
> - (b) Is claude-drive **ignoring** this feature? If so, what would integration unlock?
> - (c) What's the **integration architecture**? (MCP tool, hook, skill, plugin, channel?)
> - (d) **Effort estimate:** trivial / moderate / significant
>
> **Features to evaluate:**
>
> 1. **MCP Channels (bidirectional push)** — Could operator status transitions, activity events, and approval requests be pushed to Claude Code via channels instead of polled via `drive_get_state`? Map the existing `agentOutput` EventEmitter to channel events.
>
> 2. **Skills (slash commands)** — Could `/spawn`, `/operators`, `/costs`, `/drive-mode` be exposed as Claude Code skills? What SKILL.md frontmatter would each need? Could `context: fork` run skills as subagents?
>
> 3. **Plugin distribution** — Can claude-drive be packaged as a Claude Code plugin? What goes in the plugin manifest? How does stdio transport (cli.ts `serve-stdio`) vs HTTP transport affect plugin packaging? What capabilities does a plugin unlock vs standalone MCP?
>
> 4. **Agent teams** — How does Claude Code's native agent teams feature overlap with claude-drive's operator model? What does claude-drive offer that agent teams don't (lifecycle management, drive modes, cost governance, approval gates, TTS, session persistence)? Should claude-drive position as an orchestration layer ON TOP of agent teams?
>
> 5. **Native worktrees** — Claude Code has `--worktree` flag, `isolation: worktree` in agent config, `WorktreeCreate`/`WorktreeRemove` hooks. Is `worktreeManager.ts` duplicating native functionality? What should it keep (operator-to-worktree mapping, branch naming) vs delegate (low-level git operations)?
>
> 6. **MCP elicitation** — Could inline user questions via elicitation replace the `approvalQueue.ts` polling pattern? What are the limitations (e.g., background operators with no active tool call)?
>
> 7. **Status line** — The current status line reads `~/.claude-drive/status.json`. Could it show richer data: color-coded operator statuses, per-plan cost bars, approval queue badges, OSC 8 clickable links?
>
> 8. **Session transcripts** — Claude Code stores subagent transcripts at `~/.claude/projects/{project}/subagents/`. Could claude-drive inject prior transcripts on session restore, giving operators memory of previous work? What's the transcript format?
>
> 9. **Hooks (Claude Code side)** — Which of the 18+ Claude Code hook events should claude-drive register? Could `TaskCompleted` hooks update operator stats? Could `SubagentStart`/`SubagentStop` track operator lifecycle? Could `PreCompact` preserve critical operator context?
>
> 10. **SDK session management** — The SDK supports `resume: sessionId` for cross-restart sessions, `forkSession` for exploring alternatives, and `ClaudeSDKClient` for multi-call sessions. Is claude-drive using any of these? Could `resume` enable true operator persistence?
>
> 11. **SDK subagent definitions** — Could operators be defined as `AgentDefinition` objects with `description`, `prompt`, `tools`, `model`? Would this simplify `operatorManager.ts`?
>
> 12. **SDK custom tools** — Could claude-drive's MCP tools be defined using the SDK's `@tool` decorator / `tool()` helper with in-process MCP server (`createSdkMcpServer()`)? Would this be simpler than the raw MCP server?
>
> **Produce a competitive positioning summary:**
> - What unique value does claude-drive provide vs Claude Code's built-in capabilities?
> - Where is claude-drive redundant and should delegate to native?
> - What's the "10x moment" — the thing users can't get without claude-drive?
> - Suggested tagline for the product.

---

### Agent 8: "API Cost & Performance Optimization" (BACKGROUND)

```
Tool: Agent
subagent_type: "Explore"
run_in_background: true
description: "Research API optimization"
```

**Prompt:**

> Research API cost and performance optimization opportunities in claude-drive at `/home/user/claude-drive`. RESEARCH ONLY.
>
> **Read completely:**
> - `src/operatorManager.ts` (SDK query calls — the primary API consumer)
> - `src/planCostTracker.ts` (cost tracking)
> - `src/config.ts` (configuration)
> - `src/router.ts` (task routing)
> - `src/operatorRegistry.ts` (operator roles and presets)
>
> **Analyze and answer:**
>
> 1. **PROMPT CACHING** — Are operator system prompts marked with `cache_control`? Operator prompts are likely repeated across turns — caching could reduce input costs by 90%. What's the estimated savings for a typical 5-operator session? **Critical question:** Does the Agent SDK `query()` expose prompt caching controls, or does claude-drive need to use the Messages API directly for long-lived operators? If `buildOperatorSystemPrompt()` rebuilds every call without cache_control, the static prefix (role + tool instructions) is wasted tokens every turn.
>
> 2. **MODEL ROUTING** — Does claude-drive use the same model for all operators? Could it route by role:
>    - Researcher/reviewer → Haiku ($1→$5/MTok) for read-only analysis
>    - Implementer → Sonnet ($3→$15/MTok) for balanced coding
>    - Planner → Opus ($5→$25/MTok) for complex architectural reasoning
>    - Router decisions → Haiku for fast, cheap routing in `router.ts`
>    What's the estimated cost reduction from smart routing?
>
> 3. **EXTENDED THINKING** — Does claude-drive enable extended thinking for any operators? Should Planner operators use `maxThinkingTokens` for deeper reasoning? Is it configurable per role? Note: extended thinking disables streaming.
>
> 4. **TOKEN COUNTING** — Does claude-drive estimate costs before dispatching tasks? The free `count_tokens` endpoint could pre-calculate operator costs and warn before expensive operations. Could this feed into the approval gates?
>
> 5. **BATCH API** — Could non-urgent operator tasks use the Batch API for 50% savings? For example: code review, documentation generation, test writing that doesn't need immediate results. What architectural changes would batching require?
>
> 6. **STRUCTURED OUTPUTS** — Are operator responses validated against schemas? Could `operatorManager.ts` use structured outputs to guarantee response format? What schemas would each operator role produce?
>
> 7. **RATE LIMIT MANAGEMENT** — Does claude-drive read `anthropic-ratelimit-*-remaining` headers? With 5+ concurrent operators, rate limits become a real concern. Is there backpressure? Could the cost tracker also track rate limit headroom? Note: cached tokens don't count toward ITPM limits. **Multi-operator concurrency:** N operators hitting the API simultaneously spike ITPM. Does claude-drive need a shared rate-limit-aware dispatcher that pauses low-priority operators when approaching limits?
>
> 8. **STREAMING** — Is `includePartialMessages` enabled for real-time operator output? If not, users see nothing until the full response completes — poor UX for long-running tasks.
>
> 9. **FAST MODE** — Could simple operators (e.g., router, status queries) use `speed: "fast"` (Opus 4.6 beta) for lower latency?
>
> 10. **COST TRACKING ACCURACY** — Is `planCostTracker.ts` using `ResultMessage.total_cost_usd` (authoritative) or estimating? Is it tracking `cache_read_input_tokens` vs `cache_creation_input_tokens`? Is per-model breakdown available (TypeScript `modelUsage` map)?
>
> **Produce a cost optimization roadmap:**
>    | Optimization | Estimated Savings | Effort | Priority |
>    For each, include file references and implementation approach.

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
   - `docs/research/07-ecosystem-fit.md`
   - `docs/research/08-api-optimization.md`

**Once ALL 7 background agents have completed**, proceed to synthesis.

### Agent 9: "Product Synthesizer" (FOREGROUND — blocking)

```
Tool: Agent
subagent_type: "Plan"
description: "Synthesize vision doc"
```

**Prompt:**

> You are a product analyst. Read ALL research documents in `docs/research/` (files 01 through 08) at `/home/user/claude-drive/docs/research/`.
>
> claude-drive is built with `@anthropic-ai/claude-agent-sdk` and follows Unix design philosophy. Target platforms: Windows 11 (primary), iOS (low-hanging fruit), macOS/Linux (secondary).
>
> **Produce `docs/research/09-vision-and-requirements.md` with:**
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
>    - Is claude-drive using the SDK idiomatically? Compare against SDK best practices (sessions, hooks, streaming, custom tools, structured outputs).
>    - Could the operator/registry pattern be simplified using SDK primitives (AgentDefinition, subagents, session resume)?
>    - Should claude-drive itself be decomposable into SDK agents?
>    - Is claude-drive leveraging: prompt caching, model routing, extended thinking, streaming, structured outputs, tool search, file checkpointing?
>
> 8. **CLAUDE CODE ECOSYSTEM FIT** (from 07-ecosystem-fit.md)
>    - Summarize integration opportunities: channels, skills, plugins, elicitation, agent teams, native worktrees
>    - What should claude-drive delegate to native Claude Code vs keep as unique value?
>    - Plugin distribution strategy: standalone MCP vs Claude Code plugin
>    - Positioning: "Claude Code gives you agents. claude-drive gives you a team." — validate or refine this tagline.
>
> 9. **API COST OPTIMIZATION** (from 08-api-optimization.md)
>    - Current cost profile and optimization opportunities
>    - Model routing strategy by operator role
>    - Prompt caching impact estimate
>    - Rate limit management for concurrent operators
>
> 10. **TECHNICAL DEBT & RISKS** — Production breakage risks, user frustration points, security concerns, architecture decisions to revisit.
>
> 11. **RECOMMENDED NEXT SESSION** — Exactly what to build first, in what order, with estimated scope. Prioritize features that leverage SDK/Claude Code capabilities already available but unused.

**Save output to `docs/research/09-vision-and-requirements.md`.**

<!-- TODO: The Product Synthesizer should also produce a "Decision Log" —
     a list of architectural decisions made (or deferred) with rationale.
     Format: ADR (Architecture Decision Record). Example:
     "ADR-001: Use git worktrees for operator isolation. Considered: containers,
     separate repos, shared workspace. Chose worktrees because..."
     This prevents re-litigating settled decisions in future sessions. -->

<!-- TODO: Add a "Metrics & Success Criteria" section to the vision doc:
     - How do we know claude-drive is working? (operator task completion rate)
     - How do we know it's fast enough? (time-to-first-tool-call after spawn)
     - How do we know it's safe? (zero approval gate bypasses)
     Without measurable goals, "MVP complete" is subjective. -->

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

## SDK & Ecosystem Utilization
| Feature | Status | Impact |
|---------|--------|--------|
| Prompt caching | ? | ? |
| Model routing | ? | ? |
| Session resume | ? | ? |
| Streaming output | ? | ? |
| MCP channels | ? | ? |
| Skills (slash commands) | ? | ? |
| Plugin distribution | ? | ? |
| Elicitation (approvals) | ? | ? |

## Top 5 MVP Blockers (ordered)
1. ...

## Top 5 Quick Wins (unused SDK/Claude Code features)
1. ...

## Recommended Next Session
[Exactly what to build, in what order — prioritize leveraging existing SDK/Claude Code capabilities]

## Research Documents
- 01-build-health.md
- 02-operator-lifecycle.md
- 03-mcp-tools.md
- 04-infrastructure.md
- 05-tts-voice.md
- 06-test-coverage.md
- 07-ecosystem-fit.md
- 08-api-optimization.md
- 09-vision-and-requirements.md
```

Present this summary to the user as your final message.

<!-- TODO: Phase 4 should also produce a machine-readable `sprint-results.json`:
     { buildHealthy: bool, testsPass: bool, fileCount: N, deadCodeFiles: [...],
       windowsBlockers: [...], mvpBlockers: [...], nextActions: [...] }
     This lets future sessions programmatically check what's changed since
     the last research sprint instead of re-reading 8 markdown files. -->

<!-- TODO: Add a "Phase 5: Auto-File Issues" step that takes the top MVP blockers
     and creates GitHub issues for each one using the mcp__github tools.
     Labels: `research-sprint`, `mvp-blocker`, priority tags.
     This bridges the gap between research and execution — otherwise the
     sprint output rots in docs/ and nobody acts on it. -->

---

## Verification Checklist

Before declaring the sprint complete:

- [ ] Every `src/*.ts` and `src/*.tsx` file read by at least one agent
- [ ] Every MCP tool cataloged with implementation status and keep/remove verdict
- [ ] Every config key documented with default, type, and whether it's actually used
- [ ] Build/test status definitively known with specific error list
- [ ] Unix philosophy violations cataloged per-file with refactor recommendations
- [ ] Agent SDK usage reviewed for idiomatic patterns vs anti-patterns
- [ ] SDK features audited: sessions, hooks, streaming, custom tools, structured outputs, tool search, file checkpointing
- [ ] Claude Code ecosystem integration mapped: channels, skills, plugins, elicitation, agent teams, worktrees, status line, transcripts, hooks
- [ ] API cost optimization assessed: prompt caching, model routing, extended thinking, batch API, token counting, rate limits
- [ ] Competitive positioning defined: what claude-drive offers vs native agent teams
- [ ] Windows 11 compatibility issues listed per-file
- [ ] iOS quick-win opportunities identified with effort estimates
- [ ] All 10 research documents saved to `docs/research/`
- [ ] Clear, ordered "what to build next" list exists, prioritizing unused SDK/Claude Code capabilities
- [ ] TodoWrite shows all tasks completed

<!-- TODO: Add verification items for the new ideas above:
     - [ ] Security audit of MCP server binding (localhost only?)
     - [ ] Operator isolation adversarial review completed
     - [ ] sprint-results.json produced and parseable
     - [ ] GitHub issues created for P0 blockers
     - [ ] Decision log (ADRs) started with at least 3 entries
     - [ ] Success metrics defined and baselined
     - [ ] Plugin manifest drafted for Claude Code plugin distribution
     - [ ] SKILL.md files drafted for /spawn, /operators, /costs slash commands
     - [ ] Channel event schema defined for operator status push -->

<!-- TODO: Add a "Re-Run Protocol" section explaining how to run this sprint again
     after significant changes. Should it diff against previous sprint-results.json?
     Should it skip phases where nothing changed? A delta-sprint would be 3x faster
     and avoid redundant agent work. This is the Unix philosophy of incremental
     processing applied to research itself. -->
