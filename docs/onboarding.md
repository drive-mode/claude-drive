# Onboarding & Contributing Guide

Everything you need to go from zero to productive on claude-drive.

## Prerequisites

- **Node.js** ≥ 18 (ESM support required)
- **npm** ≥ 9
- **Git** (for worktree features)
- **Claude Code CLI** — the MCP client that talks to claude-drive

Optional for TTS:

- **edge-tts-universal** (installed via npm, default backend)
- **piper** binary + voice model (for offline neural TTS)
- System `say` command (macOS built-in, or `say` npm package)

## Environment Setup

```bash
# Clone the repo
git clone https://github.com/hhalperin/claude-drive.git
cd claude-drive

# Install dependencies
npm install

# Build TypeScript → out/
npm run compile

# Verify everything works
npm test
```

### Watch Mode

During development, keep a terminal running:

```bash
npm run watch
```

This recompiles on every save. Then in another terminal:

```bash
node out/cli.js start
```

### Global Install (optional)

```bash
npm install -g .
claude-drive start   # now available anywhere
```

## Project Structure

```
claude-drive/
├── src/                   # TypeScript source
│   ├── cli.ts             # CLI entry point (commander)
│   ├── mcpServer.ts       # MCP server (HTTP + stdio transports)
│   ├── operatorRegistry.ts # Operator lifecycle (spawn/switch/dismiss)
│   ├── operatorManager.ts # Agent SDK integration
│   ├── driveMode.ts       # State machine (active + subMode)
│   ├── router.ts          # Intent classification
│   ├── agentOutput.ts     # Terminal output + events
│   ├── tui.tsx            # Ink/React TUI
│   ├── tts.ts             # TTS dispatch
│   ├── edgeTts.ts         # Edge TTS backend
│   ├── piper.ts           # Piper TTS backend
│   ├── config.ts          # Config loader
│   ├── store.ts           # JSON KV persistence
│   ├── approvalGates.ts   # Safety pattern matching
│   ├── approvalQueue.ts   # Approval request/response
│   ├── worktreeManager.ts # Git worktree lifecycle
│   ├── gitService.ts      # Typed git wrapper
│   ├── sessionManager.ts  # Session save/restore
│   └── sessionStore.ts    # Session file I/O
├── tests/                 # Jest tests
├── out/                   # Compiled JS (gitignored)
├── docs/                  # Documentation
├── scripts/               # Utility scripts
├── CLAUDE.md              # AI agent context
├── AGENTS.md              # AI agent context (alternate)
├── CONTRIBUTING.md        # Commit guidelines
└── package.json
```

### State Directory

claude-drive stores runtime state in `~/.claude-drive/`:

```
~/.claude-drive/
├── config.json            # User configuration
├── state.json             # Drive mode + runtime KV
├── port                   # Live server port (ephemeral)
└── sessions/              # Saved session snapshots
    ├── abc123.json
    └── def456.json
```

## Key Concepts

### Operators

Operators are named Claude subagents. Each one has a role, permission preset, task, memory, and optionally its own git worktree. Think of them like team members you can spawn, switch between, and dismiss.

### Drive Mode

Two dimensions of state: `active` (boolean — is Drive orchestrating?) and `subMode` (plan | agent | ask | debug | off — how should input be routed?).

### MCP Tools

claude-drive exposes tools to Claude Code via MCP. When you run `claude-drive start`, Claude Code can call tools like `operator_spawn`, `drive_run_task`, etc. See [`docs/api-reference.md`](api-reference.md) for the full list.

### Approval Gates

Safety patterns that scan operator commands before execution. Three tiers: block (hard stop), warn (needs approval), log (informational). Patterns are configurable via `approvalGates.blockPatterns`, etc.

## Common Tasks

### Adding a New MCP Tool

1. Open `src/mcpServer.ts`
2. Add a `server.tool()` call in the appropriate section
3. Define parameters with Zod schemas
4. Implement the handler
5. Add a test in `tests/mcpServer.test.ts`
6. Document in `docs/api-reference.md`

Example:

```typescript
server.tool("my_new_tool", "Description of what it does", {
  param1: z.string(),
  param2: z.number().optional(),
}, async ({ param1, param2 }) => {
  // implementation
  return { content: [{ type: "text", text: "result" }] };
});
```

### Adding a New CLI Command

1. Open `src/cli.ts`
2. Add a new `program.command()` block
3. Keep heavy imports lazy (dynamic `import()`)
4. Add to README usage section

### Adding a New Operator Role

1. Open `src/operatorRegistry.ts`
2. Add to the `OperatorRole` type union
3. Add a template in `ROLE_TEMPLATES`
4. Update the `role` Zod enum in `mcpServer.ts` (both `operator_spawn` and `drive_run_task`)

### Modifying Config Defaults

1. Open `src/config.ts`
2. Update the `DEFAULTS` object
3. Use `getConfig<T>("key.path")` to read
4. Document the new key in README's config table

## Coding Conventions

### ESM Imports

This is an ESM project. All relative imports **must** use `.js` extensions, even though the source files are `.ts`:

```typescript
// Correct
import { getConfig } from "./config.js";

// Wrong — will break at runtime
import { getConfig } from "./config";
```

### Named Exports

Use named exports, not default exports:

```typescript
// Correct
export function doThing() { ... }
export class MyClass { ... }

// Avoid
export default function doThing() { ... }
```

### Config Access

Always use `getConfig<T>()` for reading config, never read the file directly:

```typescript
const port = getConfig<number>("mcp.port") ?? 7891;
const enabled = getConfig<boolean>("tts.enabled") ?? true;
```

### Async/Await

Prefer `async/await` over raw Promise chains:

```typescript
// Correct
const result = await gitService.getCurrentBranch();

// Avoid
gitService.getCurrentBranch().then(result => { ... });
```

## Testing

Tests use Jest with the `ts-jest` ESM preset:

```bash
npm test                          # Run all tests
npm test -- --testPathPattern=config  # Run specific test file
npm test -- --watch               # Watch mode
```

Test files live in `tests/` and follow the pattern `<module>.test.ts`.

Key testing patterns:

- **Config tests** — verify priority chain (runtime > env > file > defaults)
- **Registry tests** — operator spawn, switch, dismiss, role templates
- **MCP tests** — port file read/write
- **Drive mode tests** — state machine transitions
- **Router tests** — intent classification
- **Approval tests** — pattern matching and throttling

## Commit Guidelines

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add worktree status tool
fix: handle port file cleanup on crash
docs: update API reference with approval tools
chore: bump @anthropic-ai/sdk to latest
refactor: extract git operations to GitService class
test: add router keyword detection tests
```

Keep commits atomic. Include co-author trailers when pair programming:

```
Co-Authored-By: Harrison Halperin <harrisonhalperin@gmail.com>
Co-Authored-By: ai-secretagent <super.ai.secretagent@gmail.com>
```

## Pull Requests

All PRs require review from at least one maintainer. Squash-merge preferred for feature branches.

Before submitting:

1. `npm run compile` — no TypeScript errors
2. `npm test` — all tests pass
3. Update docs if adding/changing tools, commands, or config keys

## Sync with cursor-drive

claude-drive shares business logic with [cursor-drive](https://github.com/hhalperin/cursor-drive) (VS Code extension). When syncing changes:

**Files to sync**: `operatorRegistry.ts`, `router.ts`, `syncTypes.ts`, `tts.ts`, `edgeTts.ts`, `piper.ts`

**What to change during sync**: Replace VS Code-specific imports (`vscode`, `ExtensionContext`) with Node.js equivalents. Fix relative import paths to use `.js` extensions.

**Files NOT to sync**: `cli.ts`, `mcpServer.ts`, `tui.tsx`, `package.json`, or anything VS Code-specific.

## Who to Ask

- **[@hhalperin](https://github.com/hhalperin)** — project lead, architecture decisions, cursor-drive sync
- **[@ai-secretagent](https://github.com/ai-secretagent)** — co-maintainer, feature development
