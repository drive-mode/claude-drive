# claude-drive — Engineering Principles

These are the Unix-leaning conventions every module in this repo honours.
New code that contradicts them needs a stated reason.

## 1. Paths live in one place

- Every on-disk location claude-drive reads or writes is derived from
  `src/paths.ts`. No module computes `os.homedir() + ".claude-drive"`
  directly.
- `CLAUDE_DRIVE_HOME` overrides the default home directory. Use it for tests
  and for running two isolated instances on the same account.
- JSON state is written with `atomicWriteJSON()`. No raw `fs.writeFileSync`
  for `.json` persistence.

## 2. Logging goes to stderr

- Library code calls `logger.*` (see `src/logger.ts`), never `console.*`.
- `stdout` is reserved for CLI user-facing text and `--json` payloads.
- CLI `console.log()` is allowed; it is the top-level UI channel.
- Log levels: `debug | info | warn | error | silent`. Default is `info`.
  Controlled by config `log.level` and env `CLAUDE_DRIVE_LOG_LEVEL`.
- Format objects and `Error` instances defensively — `logger` does the right
  thing with both.

## 3. Small sharp tools; no captive UI

- Every list-style CLI command supports `--json` for pipelines.
- `--json` payloads are a single valid JSON value on stdout; no trailing
  newline noise; no prose.
- MCP tools are narrowly scoped. Prefer a single tool with a `kind` param
  over five near-duplicate tools.
- Backward-compat aliases are allowed but must log a debug deprecation note.

## 4. No module-scope mutable state

- Prefer `class Foo { /* state */ }` + a default exported singleton.
- If a module needs cached singleton state, that state must be encapsulated
  in an object (class or closure) and accompanied by a `__resetForTests()`
  hook.
- Exceptions (acknowledged cached singletons):
  - `operatorManager.startupPromise` — SDK pre-warm cache; reset via
    `__resetStartupPromise`.

## 5. Types are strict

- `strict: true`, `noUnusedLocals`, `noUnusedParameters` — enforced by
  `npm run lint`.
- Avoid `as unknown as X` and `: any`. Prefer discriminated unions + control
  flow narrowing (see `operatorManager.ts` post-Stage 8 for an example).
- Config values are validated by a zod schema in `src/configSchema.ts`;
  callers get the right types back because the schema enforces them.

## 6. Errors carry context

- Adopt the `{ ok: true, data } | { ok: false, error }` pattern for IO
  boundaries (see `src/gitService.ts`).
- Background operator errors are written to the operator's progress file as
  a typed `error` event, not just logged.
- Never swallow an error without logging at `warn` or `error` level — silence
  is a bug.

## 7. Tests are hermetic and fast

- No network, no ANTHROPIC_API_KEY, no state leakage between tests.
- Use `tests/_helpers/sdkMock.ts` (`installSdkMock`, `makeQueryStream`,
  `typicalRun`) when you need to stub the Agent SDK.
- File-I/O tests write under `os.tmpdir()` (see `tests/progressFile.test.ts`
  for the pattern).
- CLI tests spawn `node out/cli.js` with `CLAUDE_DRIVE_HOME` set to a temp
  dir (see `tests/cliJson.test.ts`).

## 8. Pushed work is the only work

- Commit per meaningful change; push immediately. Unshipped code is lost
  code.
- Commits include a "why", not just a "what", for anything non-trivial.
