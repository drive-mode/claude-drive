---
name: run-operator
description: >
  This skill should be used when the user asks to "run a task", "have an operator do X",
  "send this to the implementer", "ask the reviewer to check", "run tests with the tester",
  or any request to delegate work to a specific named operator in claude-drive.
metadata:
  version: "0.1.0"
  requires: claude-drive MCP server running
---

# Run Operator

Delegate a specific task to a claude-drive operator, routing by role or name.

## Workflow

1. Check what operators are running with `operator_list`
2. If no suitable operator exists, spawn one with `operator_spawn`
3. Dispatch the task with `drive_run_task`
4. Monitor via `agent_screen_activity` events or `drive_get_state`

## Role Routing Guide

| Task type | Recommended role | Preset |
|-----------|-----------------|--------|
| Write new feature | `implementer` | `standard` |
| Code review / audit | `reviewer` | `readonly` |
| Write/run tests | `tester` | `standard` |
| Research / docs search | `researcher` | `readonly` |
| Plan decomposition | `planner` | `readonly` |

## Example

```
# Spawn a tester and run tests
operator_spawn(name="Tester", role="tester", preset="standard")
drive_run_task(task="Run the test suite and report any failures", operatorName="Tester")
```

## Parallel Operators

Spawn multiple operators for parallel work:
```
operator_spawn(name="Alpha", role="implementer", task="Add auth endpoints")
operator_spawn(name="Beta", role="tester", task="Write auth tests")
drive_run_task(task="Implement POST /login and POST /logout", operatorName="Alpha")
drive_run_task(task="Write unit tests for auth endpoints", operatorName="Beta")
```
Each operator gets an isolated git worktree if `worktree_create` is called first.
