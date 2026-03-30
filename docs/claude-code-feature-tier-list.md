# Claude Code Feature Tier List

A comprehensive ranking of Claude Code's most valuable features for power users.

---

## S-Tier: Game Changers

### 1. CLAUDE.md (Project Instructions)

Persistent instructions Claude reads every session. Teach it your conventions, architecture, and build commands once — never repeat yourself.

- Create `./CLAUDE.md` or run `/init` to auto-generate one
- Check into version control so your whole team benefits
- Use `.claude/rules/` directory for path-scoped rules (e.g., rules that only apply when editing `src/api/**/*.ts`)
- Import external files with `@path/to/file` syntax

### 2. Auto Memory

Claude automatically takes notes about your project across sessions — build commands, preferences, patterns it discovers through working with you.

- Enabled by default (v2.1.59+)
- Check with `/memory` command; stored at `~/.claude/projects/<project>/memory/`
- Learns from your corrections ("I prefer pnpm not npm" gets remembered)
- First 200 lines of `MEMORY.md` loaded each session; detailed notes in separate topic files

### 3. Auto-Dream

Background memory consolidation — like REM sleep for Claude. A subagent periodically reviews your project memory, prunes stale info, and reorganizes everything into clean topic files.

- Available on v2.1.59+ (quiet rollout)
- Check `/memory` to see if "Auto-dream: on" appears
- Solves the biggest problem with auto memory: decay and noise over time
- Keeps memory relevant and actionable instead of growing into a bloated mess

---

## A-Tier: Automation Powerhouses

### 4. Hooks (Pre/Post Tool Execution)

Shell commands that fire at specific lifecycle points — auto-format after edits, block dangerous operations, send notifications.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "npx prettier --write" }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "./scripts/validate-command.sh" }]
      }
    ]
  }
}
```

- **Events:** `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit`, `PermissionRequest`, `SubagentStart/Stop`, `ConfigChange`, `FileChanged`, etc.
- **Hook types:** Command (shell scripts), Prompt-based (quick LLM decision), Agent-based (full verification with tool access)
- **Key insight:** Hooks are *enforced*. CLAUDE.md is suggestions. Use hooks for "always do X after Y."

### 5. Subagents (Custom Agents)

Spawn focused AI agents with isolated context — exploration, code review, debugging — without cluttering your main conversation.

- Define in `.claude/agents/` (project) or `~/.claude/agents/` (personal) with markdown + YAML frontmatter
- Control model (`sonnet`/`opus`/`haiku`), available tools, and memory scope
- Run in foreground or background for parallel work
- **Pro tip:** Isolate verbose output (test runs, logs) in subagents so your main context stays clean
- Built-in agents: Explore (read-only codebase search), Plan (for plan mode), general-purpose (multi-step work)

### 6. Permission Modes

- **Plan Mode:** Read-only exploration, no edits — perfect for complex planning before implementation
- **Auto Mode:** Smart classifier auto-approves safe operations, blocks suspicious ones
- **dontAsk Mode:** Pre-approved tools only
- Cycle with `Shift+Tab` during a session
- Can be set per-session, per-project, or made default in settings

---

## B-Tier: Serious Productivity Boosts

### 7. MCP Servers (Model Context Protocol)

Connect external tools — GitHub, databases, APIs, custom services — so Claude uses them as seamlessly as built-in tools.

```json
{
  "mcpServers": {
    "github": { "url": "http://localhost:3000/mcp" },
    "postgres": { "type": "stdio", "command": "node", "args": ["postgres-mcp.js"] }
  }
}
```

- Can be scoped to specific subagents
- Dynamic tool updates at runtime
- Push messages via channels (MCP servers can send notifications to Claude)

### 8. Headless Mode & Agent SDK

Run Claude non-interactively from scripts or CI/CD:

```bash
claude -p "Fix all linting errors" --allowedTools "Read,Edit,Bash"
```

- Python/TypeScript SDK for programmatic control
- Bare mode (`--bare`) skips hook/skill/plugin discovery for consistent CI behavior
- Great for automated code reviews, scheduled tasks, dependency audits

### 9. Session Management & Checkpointing

- `claude --continue` — resume most recent session
- `claude --resume <name>` — resume by name
- `/checkpoint create "before refactor"` — explicit savepoints
- `/rewind` — restore to earlier checkpoint
- `/branch` — fork sessions for parallel exploration
- Session picker shows time, message count, git branch, metadata

### 10. Worktrees for Parallel Work

Isolated git worktrees so multiple Claude sessions work on different features simultaneously:

```bash
claude --worktree feature-auth
claude --worktree bugfix-123
```

- Each worktree has its own branch and working directory
- Subagents can also use worktree isolation (`isolation: worktree` in frontmatter)
- Automatic cleanup on exit (keeps if changes exist, deletes if empty)

---

## C-Tier: Nice-to-Have Power Features

### 11. Custom Skills (Slash Commands)

Reusable workflow prompts in `.claude/skills/` — loaded on-demand unlike CLAUDE.md which is always loaded.

- Reduces CLAUDE.md bloat by moving reusable workflows into skills
- Can run in subagents with `context: fork`
- Share across projects via plugins

### 12. Extended Thinking (Reasoning Mode)

Deep reasoning mode for complex problems:

- Toggle with `Alt+T` (Windows/Linux) / `Option+T` (Mac)
- Adjust depth with `/effort` or `MAX_THINKING_TOKENS` env var
- Opus 4.6 / Sonnet 4.6 use adaptive reasoning (dynamic token allocation)
- Essential for complex architectural decisions and challenging bugs

### 13. Scheduled Tasks

Nightly code reviews, dependency audits, CI monitoring — runs autonomously:

- **Cloud scheduling:** `/schedule` for cron-based remote agents
- **`/loop` command:** Quick polling within a session
- **GitHub Actions:** Full CI/CD integration

### 14. IDE Integrations

- **VS Code:** Full extension with remote control, session management, git integration
- **JetBrains:** PhpStorm, WebStorm, IntelliJ, PyCharm, RubyMine
- **Desktop app:** Native macOS/Windows
- **Web app:** claude.ai/code — runs in browser with cloud environments

---

## D-Tier: Situationally Useful

### 15. Vision & Image Analysis

Paste screenshots, UI mockups, error screenshots, diagrams — Claude can generate code from UI designs.

### 16. Voice Dictation

Hands-free prompting with `Alt+Space` push-to-talk.

### 17. Multi-Scope Settings

Global / user / project / managed policy config hierarchy for fine-grained control:

- `~/.claude/settings.json` (global)
- `.claude/settings.json` (project, checked in)
- `.claude/settings.local.json` (local, gitignored)

### 18. Output Styles

Custom response formatting — terminal colors, markdown, JSON output for CI pipelines.

---

## Quick Start Recommendations

| Priority | Action | Time |
|----------|--------|------|
| 1st | Write a `CLAUDE.md` (or run `/init`) | 30 min |
| 2nd | Check `/memory` — it's already learning | 0 min |
| 3rd | Add one hook (auto-format after edits) | 15 min |
| 4th | Create one custom subagent (code reviewer) | 10 min |
| 5th | Try Plan Mode for your next big feature | 0 min |

---

## Quick Reference: Feature to Use Case

| Goal | Feature |
|------|---------|
| Teach Claude project conventions | CLAUDE.md + rules |
| Let Claude learn from corrections | Auto Memory + Auto-Dream |
| Enforce "do X after Y" | Hooks |
| Block dangerous operations | Hooks with PreToolUse + exit code 2 |
| Explore codebase without changes | Plan Mode or Explore subagent |
| Keep verbose output out of main context | Subagents |
| Run tasks on a schedule | Scheduled tasks or /loop |
| Integrate with GitHub/databases | MCP servers |
| Run in CI/CD | Headless mode (`-p`) or GitHub Actions |
| Deep reasoning on complex problems | Extended thinking (Opus 4.6) |
| Multiple agents in parallel | Agent teams or subagents with worktrees |
| Consistent behavior across team | Project CLAUDE.md + .claude/settings.json |
