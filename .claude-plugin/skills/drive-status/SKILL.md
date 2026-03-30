---
name: drive-status
description: >
  This skill should be used when the user asks for "drive status", "show operators",
  "what's running", "daemon status", or wants a snapshot of the current claude-drive state
  including active operators, pending approvals, and drive mode.
metadata:
  version: "0.1.0"
  requires: claude-drive MCP server running on localhost:7891
---

# Drive Status

Show a complete snapshot of the claude-drive daemon: mode, operators, and pending approvals.

## Prerequisites

Start the claude-drive daemon before checking status:
```bash
node out/cli.js start          # or: claude-drive start
```

## Workflow

1. Call `drive_get_state` to get the full state snapshot (active flag, sub-mode, foreground operator, all operators, pending approvals, session ID)
2. Call `operator_list` for a formatted operator listing with foreground indicator
3. Present the results:
   - **Daemon**: running/stopped, current sub-mode
   - **Operators**: name, role, preset, status, current task
   - **Pending approvals**: ID, operator, command, severity
   - **Foreground**: which operator has the wheel

## Example Output

```
Drive: active | mode: agent
Foreground: Alpha

Operators:
  ▶ Alpha [standard] active: implement auth endpoints
    Beta  [readonly]  background: review auth design

Pending approvals: none
```
