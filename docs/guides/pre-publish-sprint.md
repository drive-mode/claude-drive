# Pre-Publish Completion Sprint — Recap

Closed the three gaps blocking claude-drive from being publishable as a Claude Desktop extension.

## What Was Done

### Unit 1 — Stdio MCP transport
- `src/mcpServer.ts`: added `startMcpServerStdio()` using `StdioServerTransport` from the MCP SDK. No port binding, no port file. All internal logging goes to stderr so stdout stays clean for the MCP channel.

### Unit 2 — Plugin config + installer
- `.claude-plugin/.mcp.json`: switched from `type: "http"` (hardcoded port 7891) to `type: "stdio"` with a `PLACEHOLDER_PATH` template.
- `scripts/install-plugin.mjs`: resolves the real abs path of `out/cli.js`, substitutes it into the template, and merges the entry into `~/.claude/claude_desktop_config.json` (Windows: `%APPDATA%\Claude\`). Run once after `npm run compile`.

### Unit 3 — Ink TUI
- `src/tui.tsx`: two-pane layout — activity feed left, operator list right, Drive status bar pinned at bottom.
  - `ActivityPane`: subscribes to `agentOutput` events, accumulates up to 50 items.
  - `OperatorPane`: subscribes to `registry.onDidChange`, renders ●/○ with `Spinner` on active operators.
  - `StatusBar`: subscribes to `driveMode` change events.
- `cli.ts start` gets `--tui` flag: sets render mode to `"tui"` and calls `startTui`.

### Unit 4 — Router wired to `run`
- `cli.ts run <task>`: calls `route({ prompt, driveSubMode })` before dispatching, sets subMode from the decision, and logs the routing reason to the activity feed via `logActivity("router", ...)`.
- Added `serve-stdio` command to `cli.ts`.

### Unit 5 — Dead code cleanup
- `src/syncTypes.ts`: deleted. `SyncState` inlined as a local type alias in `operatorRegistry.ts`.
- `package.json`: removed `node-record-lpcm16` (voice input is future work; no native binary needed at install time).

### Unit 6 — Jest smoke tests
Five new test files under `tests/`:
- `router.test.ts` — keyword routing, explicit command overrides, subMode wins.
- `config.test.ts` — defaults, env var override (`CLAUDE_DRIVE_*`), `setFlag` runtime override.
- `operatorRegistry.test.ts` — spawn defaults, role presets, switch/dismiss lifecycle, `onDidChange` dispose.
- `driveMode.test.ts` — mocks `store.ts` via `jest.unstable_mockModule`, tests setActive/setSubMode/toggle/events.
- `mcpServer.test.ts` — `getPortFilePath` path shape, `readPortFile` returns undefined gracefully.

TypeScript compiled with zero errors after all changes.

## Verification

```bash
# Compile
node_modules/.bin/tsc -p ./

# Tests
npm test

# Stdio MCP (Units 1 + 2)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | node out/cli.js serve-stdio

# Plugin installer (Unit 2)
node scripts/install-plugin.mjs

# TUI (Unit 3)
node out/cli.js start --tui

# Router wired (Unit 4)
node out/cli.js run "implement the login endpoint"
# stderr: router: Prompt suggests execution (contains action keyword)
```
