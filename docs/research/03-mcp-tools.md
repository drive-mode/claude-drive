# 03 — MCP Server & Tool Surface

> **Auditor:** Claude Opus 4.6 | **Date:** 2026-03-26

---

## Complete Tool Catalog (46 Tools)

### Operator Tools (8)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| operator_spawn | name?, task?, role?, preset? | Complete | Keep (core) |
| operator_switch | nameOrId | Complete | Keep (core) |
| operator_dismiss | nameOrId | Complete | Keep (core) |
| operator_list | (none) | Complete | Keep (core) |
| operator_update_task | nameOrId, task | Complete | Keep (core) |
| operator_update_memory | nameOrId, entry | Complete | Keep (core) |
| operator_escalate | nameOrId, reason, severity | Complete | Keep (core) |
| operator_record_cost | nameOrId, costUsd, durationMs, apiDurationMs?, turns | Complete | Keep (core) |

### Agent Screen Tools (5) — **Consolidation Candidate**
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| agent_screen_activity | agent, text | Complete | **Merge** into single `emit_event` |
| agent_screen_file | agent, path, action? | Complete | **Merge** |
| agent_screen_decision | agent, text | Complete | **Merge** |
| agent_screen_clear | (none) | Complete | **Remove** (UI, not domain) |
| agent_screen_chime | name? | Complete | **Remove** (UI, not domain) |

### TTS Tools (2)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| tts_speak | text, voice? | Complete | Keep |
| tts_stop | (none) | Complete | Keep |

### Drive Mode Tools (3)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| drive_set_mode | mode | Complete | Keep (core) |
| drive_get_state | (none) | Complete | Keep (core) |
| drive_run_task | task, operatorName?, role?, preset? | Complete | Keep (core) |

### Approval Tools (2)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| approval_request | id, operatorName, command, severity | **Partial** — only logs, doesn't queue | **Fix** or remove |
| approval_respond | id, approved | Complete | Keep |

### Worktree Tools (4)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| worktree_create | operatorName, baseRef? | Complete | Keep |
| worktree_remove | operatorName | Complete | Keep |
| worktree_merge | operatorName, targetBranch | Complete | Keep |
| worktree_status | (none) | Complete | Keep |

### Session Tools (7)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| session_save | name? | Complete | **Redundant** with checkpoints |
| session_restore | id | Complete | **Redundant** with checkpoints |
| session_list | (none) | Complete | **Redundant** with checkpoints |
| session_checkpoint | name?, description? | Complete | Keep |
| session_restore_checkpoint | checkpointId | Complete | Keep |
| session_list_checkpoints | sessionId? | Complete | Keep |
| session_fork | checkpointId?, newName? | Complete | Keep |
| session_metadata | key, value | Complete | Keep |

### Cost Tools (1)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| drive_get_costs | (none) | Complete | Keep |

### Memory Tools (5)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| memory_remember | operatorName, kind, content, tags? | Complete | Keep |
| memory_recall | operatorName?, kinds?, tags?, search?, limit? | Complete | Keep |
| memory_correct | operatorName, oldId, newContent | Complete | Keep |
| memory_forget | id | Complete | Keep |
| memory_share | id | Complete | Keep |

### Hook Tools (3)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| hooks_register | id, event, type, matcher?, command?, prompt?, priority? | Complete | Keep |
| hooks_unregister | id | Complete | Keep |
| hooks_list | event? | Complete | Keep |

### Skill Tools (3)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| skill_list | (none) | Complete | Keep |
| skill_load | name, params? | Complete | Keep |
| skill_run | name, operatorName?, params? | Complete | Keep |

### Dream Tools (2)
| Tool | Parameters | Status | Verdict |
|------|-----------|--------|---------|
| dream_trigger | (none) | Complete | Keep |
| dream_status | (none) | Complete | Keep |

---

## Server Architecture

### HTTP Binding
- **Host**: `127.0.0.1` (localhost only)
- **Port**: Default 7891, range fallback (tries port+1 through port+4)
- **Port file**: `~/.claude-drive/port` — written on startup, deleted on shutdown

### Transport & Session Management
```
POST /mcp  → Create session or route to existing
GET /mcp   → Route to existing session (requires mcp-session-id header)
DELETE /mcp → Teardown session
```
- Each session gets its own `StreamableHTTPServerTransport` + `McpServer`
- Session ID from `mcp-session-id` header or auto-generated
- Stdio transport available via `serve-stdio` command

### Multi-Client Issue
**Problem**: All sessions share same `registry`, `driveMode`, `memoryStore`. Two Claude Code instances can interfere.

### Auth/CORS
- **Auth**: None (localhost-only implicit trust)
- **CORS**: N/A (MCP protocol, not REST)

---

## Event System

### Event Types (agentOutput.ts)
| Type | Fields |
|------|--------|
| ActivityEvent | agent, text, timestamp? |
| FileEvent | agent, path, action? |
| DecisionEvent | agent, text |
| ChimeEvent | name? |
| ClearEvent | (none) |

### SSE Broadcast: **DEAD CODE**
- `setSseBroadcast()` exists but is never called
- `agentScreen.webPort` (7892) config is never used
- "web" mode in `agentScreen.mode` config: **not implemented**

### TUI Integration
- `--tui` flag calls `startTui()` from tui.js
- Sets `agentOutput.setRenderMode("tui")` to suppress terminal output

---

## Status & Cost

### Status File (`~/.claude-drive/status.json`)
- **Schema**: active, subMode, foregroundOperator, operators[], totals, currentPlan, lastCompletedPlan, updatedAt
- **Write frequency**: On every registry change + mode change + startup
- **Atomic writes**: `.tmp` + `rename` pattern
- **Consumer**: Claude Code status line script

### Plan Cost Tracker
- **Lifecycle**: Plan period starts/ends on mode change to/from "plan"
- **Storage**: In-memory only — **lost on restart**
- **Integration**: Written to status.json via `flushStatus()`

---

## Tool Surface Critique

### Current: 46 tools across 11 domains — **too many**

### Consolidation Opportunities
1. **Agent screen** (5 → 1): Single `emit_event` with type field
2. **Session legacy** (3 → 0): Remove save/restore/list, keep checkpoint tools
3. **Approval** (2 → 1 or 0): Fix or remove incomplete `approval_request`

### Minimal MVP Tool Surface (~15 tools)
```
CORE:
  operator_spawn, operator_list, operator_switch, operator_dismiss
  drive_set_mode, drive_run_task, drive_get_state
  emit_event (consolidated)
  memory_remember, memory_recall, memory_correct, memory_forget
  session_checkpoint, session_restore_checkpoint, session_list_checkpoints
```

---

## Mobile / iOS Interface Points

### Current State
- No REST API, no web layer, no SSE streaming
- Port file exists for service discovery

### Minimum Changes for Mobile
1. **REST endpoints**: GET /api/status, /api/operators, /api/events (SSE), /api/memory
2. **Wire SSE**: Call `setSseBroadcast()` (currently dead code)
3. **Static HTML**: Serve minimal dashboard alongside MCP
4. **Implementation**: ~6 REST endpoints + 1 SSE stream

### Path
1. Phase 1: Static HTML + REST status endpoints
2. Phase 2: SSE real-time events
3. Phase 3: Mutation endpoints (spawn, approve)
4. Phase 4: Native iOS wrapper

---

## Critical Issues

| Issue | Impact | Fix |
|-------|--------|-----|
| Multi-session shared state | Two clients can interfere | Enforce single-session or isolate per-session |
| SSE broadcast dead code | Confusing config options | Implement or remove |
| approval_request incomplete | Tool is non-functional | Wire to approvalQueue or remove |
| Plan cost not persisted | Lost on restart | Persist to JSON or document as ephemeral |
| mcpServer.ts 684 LOC | Maintainability | Split into tool modules |

---

## Recommendations

### Short Term
1. Remove/wire `setSseBroadcast()` — implement or delete
2. Consolidate agent_screen_* into single `emit_event`
3. Fix `approval_request` — enqueue or remove
4. Document plan period as ephemeral

### Medium Term
1. Split mcpServer.ts into tool modules
2. Enforce single-session or isolate state
3. Add REST layer for mobile dashboard
4. Remove redundant session_save/restore/list

### Long Term
1. Build web mode with HTML + SSE, or formally remove
2. Native iOS app against REST API
3. Tool permission model per operator
