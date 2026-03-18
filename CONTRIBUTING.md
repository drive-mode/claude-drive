# Contributing to claude-drive

Thanks for your interest in contributing to claude-drive! This guide covers
everything you need to go from zero to a working development environment,
write and run tests, add MCP tools, port code from the cursor-drive sister
repo, and get your changes merged.

---

## Table of contents

1. [Welcome](#welcome)
2. [Dev setup](#dev-setup)
3. [Repo structure](#repo-structure)
4. [Development workflow](#development-workflow)
5. [Testing](#testing)
6. [Adding MCP tools](#adding-mcp-tools)
7. [Porting from cursor-drive](#porting-from-cursor-drive)
8. [PR process](#pr-process)
9. [Key invariants to preserve](#key-invariants-to-preserve)
10. [Issues and feedback](#issues-and-feedback)

---

## Welcome

**claude-drive** is a CLI + local MCP server that brings voice-first,
multi-operator AI pair programming to Claude Code CLI. It is a port of
[cursor-drive](../cursor-drive) — a VS Code/Cursor extension — rewritten as a
pure Node.js process with no VS Code dependency.

Operators (named Claude Code agent instances) connect to the MCP server at
`localhost:7891` and call tools to report activity, coordinate with each other,
speak via TTS, and control Drive state. The CLI exposes the same operator model
directly as subcommands.

Read the [architecture overview](./docs/architecture.md) for the full picture
before diving in.

---

## Dev setup

### Prerequisites

- **Node.js 18+** (LTS recommended — `node --version` to check)
- **npm 9+** (bundled with Node 18)
- **TypeScript 5.3+** (installed as a dev dependency — no global install needed)
- Optional: `edge-tts` or `piper` available in `PATH` if you want to test TTS backends

### Clone and install

```bash
git clone https://github.com/drive-mode/claude-drive.git
cd claude-drive
npm install
```

### Compile

```bash
npm run compile   # One-shot compile → out/
npm run build     # Alias for compile
```

TypeScript sources live in `src/`, compiled output goes to `out/`. The
`tsconfig.json` at the repo root controls compiler options.

### Verify the install

```bash
node out/cli.js --version        # Should print 0.1.0
node out/cli.js mode status      # Should print Drive state
```

---

## Repo structure

```
claude-drive/
├── src/                        # TypeScript source (13 files)
│   ├── cli.ts                  # CLI entry — Commander command tree
│   ├── mcpServer.ts            # MCP HTTP server, 14 MVP tools
│   ├── operatorManager.ts      # Agent SDK wrapper — runOperator()
│   ├── operatorRegistry.ts     # Operator lifecycle and permissions
│   ├── driveMode.ts            # Drive state machine (active + subMode)
│   ├── agentOutput.ts          # Terminal ANSI output renderer
│   ├── config.ts               # Config loader (flags > env > file > defaults)
│   ├── store.ts                # Runtime key-value persistence
│   ├── tts.ts                  # TTS orchestrator (say.js / Edge-TTS / Piper)
│   ├── edgeTts.ts              # Edge TTS backend
│   ├── piper.ts                # Piper TTS backend
│   ├── router.ts               # Intent router (stub — expand as needed)
│   └── syncTypes.ts            # Shared TypeScript types (synced from cursor-drive)
│
├── tests/                      # Jest unit tests (*.test.ts)
├── docs/
│   ├── architecture.md         # System architecture overview
│   ├── cli-reference.md        # Full CLI command reference
│   ├── configuration.md        # Config keys, env vars, file format
│   ├── mcp-tools.md            # MCP tool catalogue
│   ├── operators.md            # Operator model, roles, permission presets
│   └── tts-setup.md            # TTS backend setup and troubleshooting
│
├── package.json
├── tsconfig.json
├── CLAUDE.md                   # Instructions for Claude Code agents in this repo
└── CONTRIBUTING.md             # This file
```

The best reading order for understanding the codebase:
`cli.ts` → `operatorRegistry.ts` → `mcpServer.ts` → `operatorManager.ts`

---

## Development workflow

### Watch mode

Keep the compiler running while you edit:

```bash
npm run watch
```

TypeScript will recompile on every save. Errors appear immediately in the
terminal.

### Running locally

Start the MCP server on the default port (7891):

```bash
node out/cli.js start
```

The process prints a JSON snippet you can paste into `~/.claude/settings.json`
to register claude-drive as an MCP server for Claude Code:

```json
{
  "mcpServers": {
    "claude-drive": {
      "url": "http://localhost:7891/mcp"
    }
  }
}
```

### Testing with Claude Code

1. Start the MCP server in one terminal: `node out/cli.js start`
2. Open a second terminal and run Claude Code in any project.
3. Claude Code will discover the `claude-drive` MCP server and list its tools.
4. Call a tool manually to verify: ask Claude to call `operator_list`.

For TTS setup (optional), see [docs/tts-setup.md](./docs/tts-setup.md).

### CLI commands at a glance

```bash
node out/cli.js start                          # Start MCP server
node out/cli.js run "refactor the auth module" # One-shot task
node out/cli.js operator spawn Alice --role implementer
node out/cli.js operator list
node out/cli.js operator switch Alice
node out/cli.js operator dismiss Alice
node out/cli.js mode set agent
node out/cli.js tts "Hello world"
node out/cli.js config set tts.backend edgeTts
```

Full reference: [docs/cli-reference.md](./docs/cli-reference.md).

---

## Testing

### Running the test suite

```bash
npm test
```

This runs Jest against all `tests/**/*.test.ts` files using `ts-jest` (no
separate compile step required).

Run a single test file:

```bash
npx jest tests/operatorRegistry.test.ts
```

Run in watch mode:

```bash
npx jest --watch
```

### Where tests live

All tests go in `tests/`. Mirror the `src/` filename:

| Source file | Test file |
|---|---|
| `src/operatorRegistry.ts` | `tests/operatorRegistry.test.ts` |
| `src/driveMode.ts` | `tests/driveMode.test.ts` |
| `src/config.ts` | `tests/config.test.ts` |

### Writing new tests

- Use Jest + `ts-jest`. No additional setup needed.
- Do not import `vscode` — this repo has no VS Code dependency.
- Mock file I/O (`fs`) and network calls where needed.
- Every new `.ts` file added to `src/` should have a corresponding test file.
- Run `npm test` before pushing. CI will fail if tests are red.

Example test skeleton:

```typescript
import { OperatorRegistry } from "../src/operatorRegistry.js";

describe("OperatorRegistry", () => {
  it("spawns an operator with a default preset", () => {
    const registry = new OperatorRegistry();
    const op = registry.spawn("Alice", "fix the tests");
    expect(op.name).toBe("Alice");
    expect(op.permissionPreset).toBe("standard");
  });
});
```

---

## Adding MCP tools

The MCP server is defined in `src/mcpServer.ts` inside the `buildMcpServer`
function. Adding a tool is a two-step process.

### Step 1 — Add the handler in `mcpServer.ts`

Find the appropriate section comment (operator tools, agent screen tools, TTS
tools, drive mode tools) and add a new `server.tool(...)` call:

```typescript
server.tool(
  "my_new_tool",                          // Tool name (snake_case)
  "One-line description for Claude",      // Shown in tool catalogue
  {
    // Zod schema for input parameters
    message: z.string(),
    count:   z.number().int().optional(),
  },
  async ({ message, count }) => {
    // Implementation
    const result = doSomething(message, count ?? 1);
    return { content: [{ type: "text", text: result }] };
  }
);
```

Guidelines:
- Name tools in `snake_case`.
- Keep the description to one line — it is what Claude reads when picking tools.
- Use Zod schemas for all parameters. Mark optional fields with `.optional()`.
- Return `{ isError: true }` on recoverable errors instead of throwing.
- Do not persist transcripts or user content anywhere (privacy invariant).

### Step 2 — Document it in `docs/mcp-tools.md`

Add a row to the tools table and a short section describing parameters and
example usage. See [docs/mcp-tools.md](./docs/mcp-tools.md) for the existing
format.

### Step 3 — Add a test

Add a unit test for the handler logic in `tests/mcpServer.test.ts` (or a
dedicated file if the tool is substantial). Extract the core logic into a
helper function so it can be tested without spinning up the full HTTP server.

---

## Porting from cursor-drive

claude-drive is a direct port of
[cursor-drive](../cursor-drive) — a VS Code extension. The two repos
share an operator model and are meant to stay in sync. When cursor-drive gains
a new feature, you may need to port it here.

### How the port was done

The core operator model (`operatorRegistry.ts`, `driveMode.ts`,
`syncTypes.ts`) was copied nearly verbatim. The main change was replacing VS
Code APIs with Node.js equivalents:

| cursor-drive (VS Code) | claude-drive (Node) |
|---|---|
| `vscode.workspace.getConfiguration(key)` | `getConfig(key)` from `config.ts` |
| `vscode.window.showInformationMessage()` | `console.log()` or `logActivity()` |
| `vscode.commands.executeCommand()` | Direct function calls |
| Webview panel (agentScreen) | ANSI terminal output (`agentOutput.ts`) |
| `context.secrets` (SecretStorage) | `store.ts` with local file |
| `vscode.EventEmitter` | Node.js `EventEmitter` |

`mcpServer.ts` in cursor-drive exposes ~65 tools. claude-drive ships 14 MVP
tools. When porting additional tools:

1. Copy the handler body from `cursor-drive/src/mcpServer.ts`.
2. Replace any `vscode.*` call using the mapping above.
3. Remove any webview-specific branches (e.g. `tts.ts` in cursor-drive has a
   webview backend — skip it here; the `say.js`, Edge-TTS, and Piper backends
   are already ported).
4. Add the tool to `docs/mcp-tools.md`.

### Sister repo location

```
../cursor-drive       # relative to this repo
```

Or absolute: the two repos live side by side under the `ai-secretagent`
workspace.

### Files that are 1:1 ports (keep in sync)

- `src/operatorRegistry.ts`
- `src/driveMode.ts`
- `src/syncTypes.ts`

When you change the operator model in cursor-drive, open a matching PR here,
and vice versa.

### Files that diverge by design

- `src/mcpServer.ts` — claude-drive carries the MVP subset; cursor-drive has
  the full tool set.
- `src/tts.ts` — the webview TTS backend is omitted here.
- `src/agentOutput.ts` — replaces VS Code's webview panel with a terminal
  renderer.
- `src/cli.ts` — has no cursor-drive equivalent.

---

## PR process

### Branch naming

```
feature/<short-description>
bugfix/<short-description>
chore/<short-description>
docs/<short-description>
```

### Commit message format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description
```

**Types:**

| Type | When to use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Tooling, config, dependencies |
| `ci` | CI/CD changes |

**Scope** (optional): module name — `mcpServer`, `operatorRegistry`, `tts`,
`driveMode`, `cli`, `config`, `docs`.

**Examples:**

```
feat(mcpServer): add operator_checkpoint tool
fix(tts): gracefully handle missing say.js binary
docs(mcp-tools): document agent_screen_chime parameters
test(operatorRegistry): cover dismiss-nonexistent edge case
chore: upgrade @modelcontextprotocol/sdk to 1.27.0
```

### Workflow

1. Branch from `main`:

   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/my-feature
   ```

2. Make changes. Run tests before pushing:

   ```bash
   npm run compile
   npm test
   ```

3. Push and open a PR targeting `main`.

4. CI runs compile + test. Both must be green before merge.

5. PRs are merged with **squash merge** to keep `main` history linear.

6. Delete the feature branch after merge.

### Before you push — no secrets

Never commit:

- `.env`, `.env.local`, `.env.*.local`
- `secrets.json`, `private.*`, `tokens.*`, `auth.*`
- Any file containing real API keys or tokens (test stubs like `test-key` are fine)

Run `git diff --cached` before committing and confirm no credentials are staged.

---

## Key invariants to preserve

These invariants are load-bearing. Any PR that violates them will be rejected.

### Local-first

The core runtime has no cloud dependencies. No data leaves the machine during
normal operation. `operatorManager.ts` calls the Anthropic API, but:
- All state (operator registry, drive mode, memory) is local.
- No transcript or activity data is sent to a third-party service.

### Privacy-strict

- No telemetry.
- No transcript persistence by default. The `store.ts` layer may cache
  runtime state, but never conversation content.
- TTS backends (`say.js`, Edge-TTS, Piper) are local or user-controlled.
  Do not add cloud TTS backends without an explicit opt-in config flag.

### Operator model fidelity with cursor-drive

The operator roles (`implementer`, `reviewer`, `tester`, `researcher`,
`planner`), permission presets (`readonly`, `standard`, `full`), and
lifecycle states (`active`, `background`, `completed`, `merged`, `paused`)
must remain in sync between cursor-drive and claude-drive. Changes to
`syncTypes.ts` or `operatorRegistry.ts` require a matching PR in the sister
repo.

### MCP bridge as the only channel

Claude Code communicates with claude-drive exclusively through MCP tool calls.
Do not add side channels (shared files, environment variable polling, etc.).
This keeps the contract explicit and auditable.

---

## Issues and feedback

Open an issue or start a discussion on GitHub:
[https://github.com/drive-mode/claude-drive/issues](https://github.com/drive-mode/claude-drive/issues)

For architecture questions or operator model changes, start with a discussion
before opening a code PR — these changes often need to land in both repos
simultaneously.
