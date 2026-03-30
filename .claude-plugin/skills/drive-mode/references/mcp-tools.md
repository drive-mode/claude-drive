# claude-drive MCP Tool Reference

All tools are available when the claude-drive daemon is running (`claude-drive start`).

## Operator Lifecycle

| Tool | Description | Key Params |
|------|-------------|-----------|
| `operator_spawn` | Create a new named operator | `name`, `task`, `role`, `preset` |
| `operator_switch` | Bring an operator to foreground | `nameOrId` |
| `operator_dismiss` | Remove an operator | `nameOrId` |
| `operator_list` | List all active operators | — |
| `operator_update_task` | Change operator's current task | `nameOrId`, `task` |
| `operator_update_memory` | Append to operator memory | `nameOrId`, `entry` |
| `operator_escalate` | Operator raises issue to user | `nameOrId`, `reason`, `severity` |

## Task Execution

| Tool | Description | Key Params |
|------|-------------|-----------|
| `drive_run_task` | Dispatch task to operator | `task`, `operatorName?`, `role?`, `preset?` |
| `drive_get_state` | Full Drive state snapshot | — |
| `drive_set_mode` | Set sub-mode | `mode`: plan/agent/ask/debug/off |

## Activity Feed

| Tool | Description | Key Params |
|------|-------------|-----------|
| `agent_screen_activity` | Log what operator is doing | `agent`, `text` |
| `agent_screen_file` | Log file touched | `agent`, `path`, `action?` |
| `agent_screen_decision` | Log a key decision | `agent`, `text` |
| `agent_screen_clear` | Clear the feed | — |
| `agent_screen_chime` | Play a chime notification | `name?` |

## TTS

| Tool | Description | Key Params |
|------|-------------|-----------|
| `tts_speak` | Speak text aloud | `text`, `voice?` |
| `tts_stop` | Stop current TTS | — |

## Worktrees

| Tool | Description | Key Params |
|------|-------------|-----------|
| `worktree_create` | Allocate git worktree for operator | `operatorName`, `baseRef?` |
| `worktree_remove` | Release operator's worktree | `operatorName` |
| `worktree_merge` | Merge operator branch to target | `operatorName`, `targetBranch` |
| `worktree_status` | List all allocations | — |

## Sessions

| Tool | Description | Key Params |
|------|-------------|-----------|
| `session_save` | Save current operator state | `name?` |
| `session_restore` | Resume a saved session | `id` |
| `session_list` | List saved sessions | — |

## Approval Gates

| Tool | Description | Key Params |
|------|-------------|-----------|
| `approval_request` | Operator requests user approval | `id`, `operatorName`, `command`, `severity` |
| `approval_respond` | Approve or deny pending operation | `id`, `approved` |
