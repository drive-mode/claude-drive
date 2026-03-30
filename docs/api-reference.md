# MCP Tools API Reference

claude-drive exposes 26 tools via MCP when the daemon is running. Claude Code (or any MCP client) can call these tools over HTTP at `http://localhost:7891/mcp`.

## Operator Management

### `operator_spawn`

Spawn a new named operator (Claude subagent).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Operator name. Auto-assigned from name pool if omitted (Alpha, Beta, Gamma...) |
| `task` | string | no | Initial task description |
| `role` | enum | no | One of: `implementer`, `reviewer`, `tester`, `researcher`, `planner` |
| `preset` | enum | no | Permission level: `readonly`, `standard`, `full` |

Returns: operator name and permission preset.

### `operator_switch`

Switch the foreground operator. The current foreground operator is demoted to background.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nameOrId` | string | yes | Operator name (case-insensitive) or ID |

Returns: confirmation or error if not found.

### `operator_dismiss`

Mark an operator as completed and remove from active pool. The next background operator is promoted to foreground.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nameOrId` | string | yes | Operator name or ID |

### `operator_list`

List all active operators with their status, role, task, and permission preset. The foreground operator is marked with `▶`.

No parameters.

### `operator_update_task`

Update an operator's current task description.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nameOrId` | string | yes | Operator name or ID |
| `task` | string | yes | New task description |

### `operator_update_memory`

Append a note to an operator's memory array. Memory persists across task runs and is included in the operator's system prompt.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nameOrId` | string | yes | Operator name or ID |
| `entry` | string | yes | Memory entry to append |

### `operator_escalate`

Escalate an issue to the user from an operator.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nameOrId` | string | yes | Operator name or ID |
| `reason` | string | yes | Escalation reason |
| `severity` | enum | yes | One of: `info`, `warning`, `critical` |

## Agent Screen

Tools for logging structured events to the activity feed (terminal output or TUI).

### `agent_screen_activity`

Log a general activity message.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | yes | Agent/operator name |
| `text` | string | yes | Activity message |

### `agent_screen_file`

Log a file operation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | yes | Agent/operator name |
| `path` | string | yes | File path |
| `action` | string | no | Action type (e.g., "edit", "create", "delete") |

### `agent_screen_decision`

Log a decision made by an operator.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | yes | Agent/operator name |
| `text` | string | yes | Decision description |

### `agent_screen_clear`

Clear the agent screen / activity feed.

No parameters.

### `agent_screen_chime`

Play a notification chime.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Chime name/type |

## Text-to-Speech

### `tts_speak`

Speak text aloud via the configured TTS backend. Text is truncated to `tts.maxSpokenSentences` (default: 3).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | yes | Text to speak |
| `voice` | string | no | Override voice name |

### `tts_stop`

Stop any current TTS playback immediately.

No parameters.

## Drive Mode

### `drive_set_mode`

Set the drive sub-mode, which controls how user input is routed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | enum | yes | One of: `plan`, `agent`, `ask`, `debug`, `off` |

Mode descriptions:

- **plan** — Planning and design mode. Operator focuses on architecture and task decomposition.
- **agent** — Full autonomous execution. Operator can read, write, and run commands.
- **ask** — Pass-through. User input goes directly to the model without operator orchestration.
- **debug** — Debugging mode. Operator focuses on diagnosing and fixing issues.
- **off** — Drive is paused. No operator dispatching.

## Task Execution

### `drive_run_task`

Dispatch a task to an operator. If the named operator doesn't exist, one is spawned automatically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | yes | Task description/prompt |
| `operatorName` | string | no | Target operator name. Uses foreground operator if omitted. |
| `role` | enum | no | Operator role (if spawning new) |
| `preset` | enum | no | Permission preset (if spawning new) |

The task runs asynchronously — the tool returns immediately after dispatching.

### `drive_get_state`

Get a full snapshot of the Drive state: active status, sub-mode, foreground operator, all operators, and pending approvals.

No parameters.

Returns JSON:
```json
{
  "active": true,
  "subMode": "agent",
  "foregroundOperator": "Alpha",
  "operators": [
    { "id": "abc123", "name": "Alpha", "status": "active", "role": "implementer", "task": "...", "preset": "standard" }
  ],
  "pendingApprovals": [],
  "sessionId": "session-1234567890"
}
```

## Approval Gates

### `approval_request`

Log an approval request to the activity feed. Used by the safety system when an operator attempts a blocked or warned operation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Approval request ID |
| `operatorName` | string | yes | Requesting operator |
| `command` | string | yes | Command awaiting approval |
| `severity` | enum | yes | `warn` or `block` |

### `approval_respond`

Approve or deny a pending approval request.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Approval request ID |
| `approved` | boolean | yes | `true` to approve, `false` to deny |

## Git Worktrees

Tools for isolating each operator in its own git worktree. Only available when running inside a git repository.

### `worktree_create`

Allocate a git worktree for an operator. Creates a branch `drive/op/<operatorId>` and a worktree directory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operatorName` | string | yes | Operator name or ID |
| `baseRef` | string | no | Git ref to branch from (default: `HEAD`) |

### `worktree_remove`

Release an operator's worktree. Removes the worktree directory and deletes the branch.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operatorName` | string | yes | Operator name or ID |

### `worktree_merge`

Merge an operator's worktree branch into a target branch using `--no-ff`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operatorName` | string | yes | Operator name or ID |
| `targetBranch` | string | yes | Branch to merge into |

### `worktree_status`

List all current worktree allocations showing operator ID, worktree path, and branch name.

No parameters.

## Session Management

### `session_save`

Save a snapshot of the current Drive state (operators, mode, activity log) to disk.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Human-readable session name |

Returns: session ID.

Sessions are stored in `~/.claude-drive/sessions/<id>.json`.

### `session_restore`

Restore operators and drive mode from a saved session. Operators are re-spawned from the snapshot.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Session ID |

### `session_list`

List all saved sessions with their ID, name, creation date, and active operator count.

No parameters.

## Error Handling

All tools return a standard MCP result object. On error, the result includes `isError: true` and a descriptive error message. Common errors:

- `Operator not found: <nameOrId>` — The specified operator doesn't exist or has been dismissed.
- `Worktree manager not available (not a git repo)` — Worktree tools require a git repository.
- `Git service not available` — Git operations failed to initialize.
- `No branch for operator: <name>` — The operator doesn't have a worktree allocation.

## Transport

The MCP server supports two transports:

- **HTTP** (default): `StreamableHTTPServerTransport` on `http://127.0.0.1:<port>/mcp`. Per-session MCP instances identified by `mcp-session-id` header.
- **Stdio**: For Claude Desktop plugin integration via `claude-drive serve-stdio`.
