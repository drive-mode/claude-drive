/**
 * mcpServer.ts — MCP server for claude-drive.
 * Exposes Drive tools to Claude Code CLI on localhost:<port>/mcp.
 * Adapted from cursor-drive: removed vscode deps, wired to agentOutput + config.
 */
import http from "http";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { OperatorRegistry } from "./operatorRegistry.js";
import type { DriveModeManager } from "./driveMode.js";
import { logActivity, logFile, logDecision, agentOutput } from "./agentOutput.js";
import { speak, stop as ttsStop } from "./tts.js";
import { runOperator } from "./operatorManager.js";
import { listPendingApprovals, respondToApproval } from "./approvalQueue.js";
import type { WorktreeManager } from "./worktreeManager.js";
import type { GitService } from "./gitService.js";
import { PersistentMemory } from "./persistentMemory.js";
import { SessionMemory } from "./sessionMemory.js";
import { isToolAllowedForPreset } from "./toolAllowlist.js";
import { StateSyncCoordinator } from "./stateSyncCoordinator.js";
import { SyncLedger } from "./syncLedger.js";
import { IntegrationQueue } from "./integrationQueue.js";
import { processPipeline, getPipelineStats, type PipelineContext } from "./pipeline.js";
import { getSteeringStats } from "./approvalGates.js";
import { sanitizePrompt } from "./sanitizer.js";
import { runVerification } from "./verifier.js";
import { extractTangentNameAndTask } from "./tangentNameExtractor.js";
import { runGovernanceScan, evaluateFocusGuard } from "./governance/index.js";
import { switchMode } from "./modeSwitcher.js";
import type { CommsAgent } from "./commsAgent.js";
import type { CostTracker } from "./costTracker.js";

export function getPortFilePath(): string {
  return path.join(os.homedir(), ".claude-drive", "port");
}

export function readPortFile(): number | undefined {
  try {
    const raw = fs.readFileSync(getPortFilePath(), "utf-8").trim();
    const n = parseInt(raw, 10);
    return isNaN(n) ? undefined : n;
  } catch {
    return undefined;
  }
}

function writePortFile(port: number): void {
  const filePath = getPortFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, String(port), "utf-8");
}

function deletePortFile(): void {
  try { fs.unlinkSync(getPortFilePath()); } catch { /* already gone */ }
}

export interface McpServerOptions {
  port: number;
  registry: OperatorRegistry;
  driveMode: DriveModeManager;
  worktreeManager?: WorktreeManager;
  gitService?: GitService;
  sessionId?: string;
  workspaceRoot?: string;
  persistentMemory?: PersistentMemory;
  sessionMemory?: SessionMemory;
  syncCoordinator?: StateSyncCoordinator;
  integrationQueue?: IntegrationQueue;
  commsAgent?: CommsAgent;
  costTracker?: CostTracker;
}

// Map of sessionId → { transport, server }
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

// Drain state for graceful shutdown
let draining = false;

function buildMcpServer(opts: McpServerOptions): McpServer {
  const { registry, driveMode } = opts;
  const server = new McpServer({ name: "claude-drive", version: "0.1.0" });

  // ── Operator tools ────────────────────────────────────────────────────────

  server.tool("operator_spawn", "Spawn a new named operator", {
    name: z.string().optional(),
    task: z.string().optional(),
    role: z.enum(["implementer", "reviewer", "tester", "researcher", "planner"]).optional(),
    preset: z.enum(["readonly", "standard", "full"]).optional(),
  }, async ({ name, task, role, preset }) => {
    const op = registry.spawn(name, task ?? "", { role, preset });
    return { content: [{ type: "text", text: `Spawned operator: ${op.name} (${op.permissionPreset})` }] };
  });

  server.tool("operator_switch", "Switch to a different operator", {
    nameOrId: z.string(),
  }, async ({ nameOrId }) => {
    const op = registry.switchTo(nameOrId);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${nameOrId}` }], isError: true };
    return { content: [{ type: "text", text: `Switched to ${op.name}` }] };
  });

  server.tool("operator_dismiss", "Dismiss an operator", {
    nameOrId: z.string(),
  }, async ({ nameOrId }) => {
    const ok = registry.dismiss(nameOrId);
    return { content: [{ type: "text", text: ok ? `Dismissed ${nameOrId}` : `Not found: ${nameOrId}` }] };
  });

  server.tool("operator_list", "List active operators", {}, async () => {
    const ops = registry.getActive();
    const fg = registry.getForeground();
    const text = ops.length === 0
      ? "No active operators."
      : ops.map((o) => `${o.id === fg?.id ? "▶" : " "} ${o.name} [${o.permissionPreset}] ${o.status}${o.task ? `: ${o.task}` : ""}`).join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("operator_update_task", "Update an operator's current task", {
    nameOrId: z.string(),
    task: z.string(),
  }, async ({ nameOrId, task }) => {
    const ok = registry.updateTask(nameOrId, task);
    return { content: [{ type: "text", text: ok ? `Updated task for ${nameOrId}` : `Not found: ${nameOrId}` }] };
  });

  server.tool("operator_update_memory", "Append a note to operator memory", {
    nameOrId: z.string(),
    entry: z.string(),
  }, async ({ nameOrId, entry }) => {
    registry.updateMemory(nameOrId, entry);
    return { content: [{ type: "text", text: `Memory updated for ${nameOrId}` }] };
  });

  server.tool("operator_await", "Wait for an operator to complete and return the result", {
    name: z.string(),
    timeoutMs: z.number().optional(),
  }, async ({ name, timeoutMs }) => {
    const op = registry.findByNameOrId(name);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${name}` }], isError: true };

    if (registry.isCompleted(op.id)) {
      const completed = op.status === "merged" ? "merged" : op.status;
      return { content: [{ type: "text", text: JSON.stringify({ success: true, status: completed }) }] };
    }

    const completionPromise = registry.awaitCompletion(op.id);
    if (!completionPromise) {
      return { content: [{ type: "text", text: `No completion tracker for operator: ${name}` }], isError: true };
    }

    const timeout = timeoutMs ?? 300_000;
    const result = await Promise.race([
      completionPromise,
      new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, error: "timeout" }), timeout)
      ),
    ]);

    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.tool("operator_verify", "Run verification commands in an operator's worktree", {
    name: z.string(),
  }, async ({ name }) => {
    const op = registry.findByNameOrId(name);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${name}` }], isError: true };

    const worktreePath = opts.worktreeManager?.getAllocation(op.id)?.worktreePath ?? op.worktreePath;
    if (!worktreePath) {
      return { content: [{ type: "text", text: `No worktree path for operator: ${name}` }], isError: true };
    }

    const result = await runVerification(worktreePath);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  // ── Agent Screen tools ────────────────────────────────────────────────────

  server.tool("agent_screen_activity", "Log an activity message to the agent screen", {
    agent: z.string(),
    text: z.string(),
  }, async ({ agent, text }) => {
    logActivity(agent, text);
    return { content: [{ type: "text", text: "logged" }] };
  });

  server.tool("agent_screen_file", "Log a file touch to the agent screen", {
    agent: z.string(),
    path: z.string(),
    action: z.string().optional(),
  }, async ({ agent, path, action }) => {
    logFile(agent, path, action);
    return { content: [{ type: "text", text: "logged" }] };
  });

  server.tool("agent_screen_decision", "Log a decision to the agent screen", {
    agent: z.string(),
    text: z.string(),
  }, async ({ agent, text }) => {
    logDecision(agent, text);
    return { content: [{ type: "text", text: "logged" }] };
  });

  server.tool("agent_screen_clear", "Clear the agent screen", {}, async () => {
    agentOutput.emit("event", { type: "clear" });
    return { content: [{ type: "text", text: "cleared" }] };
  });

  server.tool("agent_screen_chime", "Play a chime notification", {
    name: z.string().optional(),
  }, async ({ name }) => {
    agentOutput.emit("event", { type: "chime", name });
    return { content: [{ type: "text", text: "chime" }] };
  });

  // ── TTS tools ─────────────────────────────────────────────────────────────

  server.tool("tts_speak", "Speak text aloud via TTS", {
    text: z.string(),
    voice: z.string().optional(),
  }, async ({ text, voice }) => {
    speak(text, voice);
    return { content: [{ type: "text", text: "speaking" }] };
  });

  server.tool("tts_stop", "Stop TTS playback", {}, async () => {
    ttsStop();
    return { content: [{ type: "text", text: "stopped" }] };
  });

  // ── Drive mode tool ───────────────────────────────────────────────────────

  server.tool("drive_set_mode", "Set the drive sub-mode (supports aliases like 'coding', 'planning', 'stop')", {
    mode: z.string().describe("Mode name or alias: plan, agent, ask, debug, off, coding, planning, stop, etc."),
  }, async ({ mode }) => {
    const result = switchMode(driveMode, mode);
    if (!result.success) {
      return { content: [{ type: "text", text: result.error ?? "Unknown error" }], isError: true };
    }
    const msg = result.from === result.to
      ? `Already in ${result.to} mode`
      : `Mode switched: ${result.from} -> ${result.to}`;
    return { content: [{ type: "text", text: msg }] };
  });

  // ── Drive run / state tools ───────────────────────────────────────────────

  server.tool("drive_run_task", "Dispatch a task to an operator", {
    task: z.string(),
    operatorName: z.string().optional(),
    role: z.enum(["implementer", "reviewer", "tester", "researcher", "planner"]).optional(),
    preset: z.enum(["readonly", "standard", "full"]).optional(),
  }, async ({ task, operatorName, role, preset }) => {
    let op = operatorName ? registry.findByNameOrId(operatorName) : registry.getForeground();
    if (!op) {
      op = registry.spawn(operatorName, task, { role, preset });
    }
    void runOperator(op, task, { allOperators: registry.getActive(), registry, costTracker: opts.costTracker }).then((result) => {
      if (opts.commsAgent) {
        opts.commsAgent.push({
          type: result.success ? "completion" : "error",
          operatorName: op.name,
          message: result.success ? `Completed: ${task}` : `Failed: ${result.error ?? "unknown"}`,
          timestamp: Date.now(),
        });
      }
    });
    return { content: [{ type: "text", text: `Task dispatched to ${op.name}: ${task}` }] };
  });

  server.tool("drive_get_state", "Get full Drive state snapshot", {}, async () => {
    const fg = registry.getForeground();
    const operators = registry.getActive().map((o) => ({
      id: o.id, name: o.name, status: o.status, role: o.role,
      task: o.task, preset: o.permissionPreset,
    }));
    const pendingApprovals = listPendingApprovals().map((a) => ({
      id: a.id, operatorName: a.operatorName, command: a.command, severity: a.severity,
    }));
    const state = {
      active: driveMode.active,
      subMode: driveMode.subMode,
      foregroundOperator: fg?.name,
      operators,
      pendingApprovals,
      sessionId: opts.sessionId,
    };
    return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
  });

  server.tool("operator_escalate", "Operator escalates to user", {
    nameOrId: z.string(),
    reason: z.string(),
    severity: z.enum(["info", "warning", "critical"]),
  }, async ({ nameOrId, reason, severity }) => {
    const ok = registry.escalate(nameOrId, reason, severity);
    if (!ok) return { content: [{ type: "text", text: `Operator not found: ${nameOrId}` }], isError: true };
    logActivity(nameOrId, `[Escalation/${severity}] ${reason}`);
    return { content: [{ type: "text", text: `Escalated: ${reason}` }] };
  });

  server.tool("approval_request", "Request user approval for a pending operation", {
    id: z.string(),
    operatorName: z.string(),
    command: z.string(),
    severity: z.enum(["warn", "block"]),
  }, async ({ id, operatorName, command, severity }) => {
    logActivity(operatorName, `[Approval ${severity}] ${command}`);
    return { content: [{ type: "text", text: `Approval request logged: ${id}` }] };
  });

  server.tool("approval_respond", "Approve or deny a pending operation", {
    id: z.string(),
    approved: z.boolean(),
  }, async ({ id, approved }) => {
    const ok = respondToApproval(id, approved);
    return { content: [{ type: "text", text: ok ? `${approved ? "Approved" : "Denied"}: ${id}` : `Request not found: ${id}` }] };
  });

  // ── Worktree tools ────────────────────────────────────────────────────────

  server.tool("worktree_create", "Allocate a git worktree for an operator", {
    operatorName: z.string(),
    baseRef: z.string().optional(),
  }, async ({ operatorName, baseRef }) => {
    if (!opts.worktreeManager) {
      return { content: [{ type: "text", text: "Worktree manager not available (not a git repo)" }], isError: true };
    }
    const op = registry.findByNameOrId(operatorName);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${operatorName}` }], isError: true };
    try {
      const allocation = await opts.worktreeManager.allocate(op.id, baseRef ?? "HEAD");
      registry.updateWorkspaceState(op.id, { worktreePath: allocation.worktreePath, branchName: allocation.branchName });
      return { content: [{ type: "text", text: `Worktree created: ${allocation.worktreePath} on ${allocation.branchName}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Failed: ${e}` }], isError: true };
    }
  });

  server.tool("worktree_remove", "Release an operator's worktree", {
    operatorName: z.string(),
  }, async ({ operatorName }) => {
    if (!opts.worktreeManager) {
      return { content: [{ type: "text", text: "Worktree manager not available" }], isError: true };
    }
    const op = registry.findByNameOrId(operatorName);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${operatorName}` }], isError: true };
    await opts.worktreeManager.release(op.id);
    return { content: [{ type: "text", text: `Worktree released for ${op.name}` }] };
  });

  server.tool("worktree_merge", "Merge an operator's worktree branch", {
    operatorName: z.string(),
    targetBranch: z.string(),
  }, async ({ operatorName, targetBranch }) => {
    if (!opts.gitService) {
      return { content: [{ type: "text", text: "Git service not available" }], isError: true };
    }
    const op = registry.findByNameOrId(operatorName);
    if (!op?.branchName) return { content: [{ type: "text", text: `No branch for operator: ${operatorName}` }], isError: true };
    const result = await opts.gitService.mergeNoFf(op.branchName);
    if (!result.ok) return { content: [{ type: "text", text: `Merge failed: ${result.error}` }], isError: true };
    return { content: [{ type: "text", text: `Merged ${op.branchName} → ${targetBranch}: ${result.data}` }] };
  });

  server.tool("worktree_status", "List all worktree allocations", {}, async () => {
    if (!opts.worktreeManager) {
      return { content: [{ type: "text", text: "Worktree manager not available" }] };
    }
    const allocations = opts.worktreeManager.listAllocations();
    const text = allocations.length === 0
      ? "No worktree allocations."
      : allocations.map((a) => `${a.operatorId}: ${a.worktreePath} [${a.branchName}]`).join("\n");
    return { content: [{ type: "text", text }] };
  });

  // ── Session tools ─────────────────────────────────────────────────────────

  server.tool("session_save", "Save current session to disk", {
    name: z.string().optional(),
  }, async ({ name }) => {
    const { createSession } = await import("./sessionManager.js");
    const id = createSession(registry, driveMode, name);
    return { content: [{ type: "text", text: `Session saved: ${id}` }] };
  });

  server.tool("session_restore", "Restore operators from a saved session", {
    id: z.string(),
  }, async ({ id }) => {
    const { resumeSession } = await import("./sessionManager.js");
    const ok = resumeSession(id, registry, driveMode);
    return { content: [{ type: "text", text: ok ? `Restored session: ${id}` : `Session not found: ${id}` }] };
  });

  server.tool("session_list", "List all saved sessions", {}, async () => {
    const { listSessions } = await import("./sessionManager.js");
    const slist = listSessions();
    if (slist.length === 0) return { content: [{ type: "text", text: "No saved sessions." }] };
    const text = slist.map((s) => {
      const date = new Date(s.createdAt).toLocaleString();
      const opCount = s.operators.filter((o) => o.status !== "completed").length;
      return `${s.id}  ${s.name ?? "(unnamed)"}  ${date}  ${opCount} operator(s)`;
    }).join("\n");
    return { content: [{ type: "text", text }] };
  });

  // ── Persistent Memory tools ──────────────────────────────────────────────

  server.tool("persistent_memory_append", "Append a note to today's daily memory log", {
    note: z.string(),
    agent: z.string().optional(),
  }, async ({ note, agent }) => {
    if (!opts.persistentMemory) return { content: [{ type: "text", text: "Persistent memory not initialized (no workspace root)" }], isError: true };
    await opts.persistentMemory.appendToDaily(note, agent);
    return { content: [{ type: "text", text: "Appended to daily log" }] };
  });

  server.tool("persistent_memory_search", "Search persistent memory logs by keyword", {
    keyword: z.string(),
    limit: z.number().optional(),
  }, async ({ keyword, limit }) => {
    if (!opts.persistentMemory) return { content: [{ type: "text", text: "Persistent memory not initialized" }], isError: true };
    const results = await opts.persistentMemory.search(keyword, limit ?? 10);
    if (results.length === 0) return { content: [{ type: "text", text: `No results for "${keyword}"` }] };
    const text = results.map((r) => `[${r.date}] (score: ${r.score}) ${r.snippet}`).join("\n\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("persistent_memory_write_curated", "Write/overwrite the curated MEMORY.md file", {
    content: z.string(),
  }, async ({ content }) => {
    if (!opts.persistentMemory) return { content: [{ type: "text", text: "Persistent memory not initialized" }], isError: true };
    await opts.persistentMemory.writeCurated(content);
    return { content: [{ type: "text", text: "Curated memory updated" }] };
  });

  server.tool("persistent_memory_context", "Get full persistent memory context (curated + recent logs)", {}, async () => {
    if (!opts.persistentMemory) return { content: [{ type: "text", text: "Persistent memory not initialized" }] };
    const ctx = await opts.persistentMemory.buildPromptContext();
    return { content: [{ type: "text", text: ctx || "(empty)" }] };
  });

  // ── Session Memory tools ────────────────────────────────────────────────

  server.tool("session_memory_add_decision", "Record a key decision in session memory", {
    decision: z.string(),
    agent: z.string().optional(),
  }, async ({ decision, agent }) => {
    if (!opts.sessionMemory) return { content: [{ type: "text", text: "Session memory not initialized" }], isError: true };
    opts.sessionMemory.addDecision(decision, agent);
    return { content: [{ type: "text", text: "Decision recorded" }] };
  });

  server.tool("session_memory_context", "Get current session memory context string", {
    operatorId: z.string().optional(),
    visibility: z.enum(["isolated", "shared", "collaborative"]).optional(),
  }, async ({ operatorId, visibility }) => {
    if (!opts.sessionMemory) return { content: [{ type: "text", text: "(no session memory)" }] };
    const text = operatorId
      ? opts.sessionMemory.buildContextForOperator(operatorId, visibility ?? "shared")
      : opts.sessionMemory.buildContextString();
    return { content: [{ type: "text", text: text || "(empty)" }] };
  });

  // ── Sync Orchestration tools ────────────────────────────────────────────

  server.tool("sync_status", "Get full sync status snapshot (all operators, proposals)", {}, async () => {
    if (!opts.syncCoordinator) return { content: [{ type: "text", text: "Sync coordinator not available (not a git repo)" }], isError: true };
    try {
      const snapshot = await opts.syncCoordinator.computeSnapshot();
      return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Sync error: ${e}` }], isError: true };
    }
  });

  server.tool("sync_proposal_list", "List pending merge proposals", {}, async () => {
    if (!opts.syncCoordinator) return { content: [{ type: "text", text: "Sync coordinator not available" }], isError: true };
    const proposals = opts.syncCoordinator.getActiveProposals();
    if (proposals.length === 0) return { content: [{ type: "text", text: "No pending proposals." }] };
    const text = proposals.map((p) =>
      `${p.id} [${p.status}] ${p.operatorName}: ${p.changedFiles.length} files changed${p.conflictingFiles.length > 0 ? `, ${p.conflictingFiles.length} conflicts` : ""}`
    ).join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("sync_proposal_apply", "Approve and apply a merge proposal", {
    proposalId: z.string(),
  }, async ({ proposalId }) => {
    if (!opts.syncCoordinator || !opts.integrationQueue) {
      return { content: [{ type: "text", text: "Sync system not available" }], isError: true };
    }
    const approved = opts.syncCoordinator.approveProposal(proposalId);
    if (!approved) return { content: [{ type: "text", text: `Proposal not found or not pending: ${proposalId}` }], isError: true };
    const proposal = opts.syncCoordinator.getProposal(proposalId);
    if (!proposal) return { content: [{ type: "text", text: "Proposal disappeared after approval" }], isError: true };
    opts.integrationQueue.enqueue(proposal);
    const result = await opts.integrationQueue.processNext();
    if (!result) return { content: [{ type: "text", text: "No proposal to process" }], isError: true };
    if (result.success) {
      opts.syncCoordinator.markApplied(proposalId, result.mergeCommit ?? "");
      return { content: [{ type: "text", text: `Merged: ${result.mergeCommit}` }] };
    } else {
      opts.syncCoordinator.markFailed(proposalId, result.error ?? "unknown");
      return { content: [{ type: "text", text: `Merge failed: ${result.error}${result.conflictFiles?.length ? `\nConflicts: ${result.conflictFiles.join(", ")}` : ""}` }], isError: true };
    }
  });

  // ── Pipeline + Stats tools ──────────────────────────────────────────────

  server.tool("pipeline_process", "Process user input through the full Drive pipeline", {
    input: z.string(),
  }, async ({ input }) => {
    const pctx: PipelineContext = {
      driveActive: driveMode.active,
      driveSubMode: driveMode.subMode,
      sessionMemory: opts.sessionMemory,
      persistentMemory: opts.persistentMemory,
      operatorRegistry: registry,
    };
    const result = await processPipeline(input, pctx);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.tool("steering_stats", "Get approval gate and pipeline statistics", {}, async () => {
    const gateStats = getSteeringStats();
    const pipeStats = getPipelineStats();
    return { content: [{ type: "text", text: JSON.stringify({ gates: gateStats, pipeline: pipeStats }, null, 2) }] };
  });

  // ── Tangent tool ────────────────────────────────────────────────────────

  server.tool("tangent_spawn", "Parse tangent command and spawn background operator", {
    text: z.string().describe("Text after the tangent keyword, e.g. 'Alpha — research clerk integration'"),
  }, async ({ text }) => {
    const { name, task } = await extractTangentNameAndTask(text);
    const op = registry.spawn(name, task, { role: "researcher", preset: "readonly" });
    logActivity("Drive", `Tangent spawned ${op.name}: ${task}`);
    return { content: [{ type: "text", text: `Spawned ${op.name} for: ${task}` }] };
  });

  // ── Sanitize tool ───────────────────────────────────────────────────────

  // ── Governance tools ───────────────────────────────────────────────────

  server.tool("governance_scan", "Run a full governance scan (entropy, findings, tasks)", {
    rootDir: z.string().optional().describe("Workspace root (defaults to cwd)"),
  }, async ({ rootDir }) => {
    const root = rootDir ?? opts.workspaceRoot ?? process.cwd();
    const result = await runGovernanceScan(root);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  server.tool("governance_focus_check", "Check if an operator stayed within task scope", {
    operatorName: z.string(),
    task: z.string(),
    filesTouched: z.array(z.string()),
  }, async ({ operatorName, task, filesTouched }) => {
    const result = evaluateFocusGuard({ operatorName, task, filesTouched });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  // ── CommsAgent tools ──────────────────────────────────────────────────

  server.tool("comms_push", "Push an event to the comms agent for batched reporting", {
    type: z.enum(["progress", "completion", "sync", "error", "info"]),
    operatorName: z.string(),
    message: z.string(),
  }, async ({ type, operatorName, message }) => {
    if (!opts.commsAgent) {
      return { content: [{ type: "text", text: "CommsAgent not initialized" }] };
    }
    opts.commsAgent.push({ type, operatorName, message, timestamp: Date.now() });
    return { content: [{ type: "text", text: `Queued (${opts.commsAgent.pending} pending)` }] };
  });

  server.tool("comms_flush", "Force-flush comms agent (summarize and broadcast queued events)", {}, async () => {
    if (!opts.commsAgent) {
      return { content: [{ type: "text", text: "CommsAgent not initialized" }] };
    }
    const summary = await opts.commsAgent.flush();
    return { content: [{ type: "text", text: summary ?? "(no events queued)" }] };
  });

  server.tool("sanitize_prompt", "Sanitize a prompt (remove injection patterns, truncate)", {
    text: z.string(),
  }, async ({ text }) => {
    const result = sanitizePrompt(text);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  // ── Cost tracking tools ──────────────────────────────────────────────────

  server.tool("cost_summary", "Get session cost summary (total cost, tokens, duration, request count)", {}, async () => {
    if (!opts.costTracker) {
      return { content: [{ type: "text", text: "Cost tracking not available" }], isError: true };
    }
    const summary = opts.costTracker.getSessionTotal();
    const durationMin = (summary.sessionDurationMs / 60_000).toFixed(1);
    const text = JSON.stringify({
      totalCostUsd: `$${summary.totalCostUsd.toFixed(4)}`,
      totalInputTokens: summary.totalInputTokens,
      totalOutputTokens: summary.totalOutputTokens,
      totalRequests: summary.totalRequests,
      sessionDuration: `${durationMin} min`,
    }, null, 2);
    return { content: [{ type: "text", text }] };
  });

  server.tool("cost_by_operator", "Get per-operator cost breakdown (name, tokens, cost, requests)", {}, async () => {
    if (!opts.costTracker) {
      return { content: [{ type: "text", text: "Cost tracking not available" }], isError: true };
    }
    const costs = opts.costTracker.getAllCosts();
    if (costs.length === 0) {
      return { content: [{ type: "text", text: "No operator costs recorded yet." }] };
    }
    const rows = costs.map((c) => ({
      operator: c.operatorName,
      costUsd: `$${c.costUsd.toFixed(4)}`,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      cacheReadTokens: c.cacheReadTokens,
      cacheCreationTokens: c.cacheCreationTokens,
      requests: c.requests,
    }));
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  });

  return server;
}

export async function startMcpServerStdio(opts: Omit<McpServerOptions, "port">): Promise<void> {
  const server = buildMcpServer({ ...opts, port: 0 });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[claude-drive] MCP server running over stdio\n");
}

export async function startMcpServer(opts: McpServerOptions): Promise<{ port: number; close: () => void }> {
  const { port } = opts;
  const portRange: number = (await import("./config.js")).getConfig<number>("mcp.portRange") ?? 5;

  const httpServer = http.createServer(async (req, res) => {
    // Health check endpoint — no session required
    if (req.method === "GET" && req.url === "/health") {
      const body = JSON.stringify({
        status: draining ? "draining" : "ok",
        uptime: process.uptime(),
        port: boundPort,
        operators: opts.registry.activeCount(),
        draining,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    // Shutdown endpoint — graceful drain then stop
    if (req.method === "POST" && req.url === "/shutdown") {
      if (draining) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "already draining" }));
        return;
      }
      draining = true;
      const activeCount = opts.registry.activeCount();
      console.log(`[claude-drive] Draining active operators... (${activeCount} active)`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "shutting down", draining: true, activeOperators: activeCount }));

      if (activeCount === 0) {
        cleanup();
        httpServer.close(() => process.exit(0));
        return;
      }

      const { getConfig: gc } = await import("./config.js");
      const drainTimeoutMs: number = gc<number>("shutdown.drainTimeoutMs") ?? 30_000;
      const pollIntervalMs = 500;
      let elapsed = 0;

      const drainInterval = setInterval(() => {
        elapsed += pollIntervalMs;
        const remaining = opts.registry.activeCount();
        if (remaining === 0 || elapsed >= drainTimeoutMs) {
          clearInterval(drainInterval);
          if (remaining > 0) {
            console.log(`[claude-drive] Drain timeout reached with ${remaining} operator(s) still active. Forcing shutdown.`);
          } else {
            console.log("[claude-drive] All operators drained. Shutting down.");
          }
          cleanup();
          httpServer.close(() => process.exit(0));
        }
      }, pollIntervalMs);
      return;
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // ── GET /events — SSE stream of drive events ───────────────────────────
    if (req.method === "GET" && parsedUrl.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      // Send initial state snapshot
      const initOperators = opts.registry.getActive().map((op) => ({
        id: op.id, name: op.name, role: op.role, status: op.status, task: op.task,
      }));
      const costData = opts.costTracker?.getSessionTotal();
      const initState = {
        type: "init",
        operators: initOperators,
        mode: opts.driveMode.subMode,
        active: opts.driveMode.active,
        ...(costData ? {
          totalCostUsd: costData.totalCostUsd,
          totalInputTokens: costData.totalInputTokens,
          totalOutputTokens: costData.totalOutputTokens,
        } : {}),
      };
      res.write(`data: ${JSON.stringify(initState)}\n\n`);

      // Keep connection alive
      const heartbeat = setInterval(() => {
        try { res.write(": heartbeat\n\n"); } catch { /* client gone */ }
      }, 15000);

      // Forward agentOutput events
      const onEvent = (event: { type: string; agent?: string; text?: string; path?: string; action?: string }) => {
        try {
          const payload: Record<string, unknown> = { ...event, timestamp: Date.now() };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch { /* client gone */ }
      };
      agentOutput.on("event", onEvent);

      // Forward operator registry changes
      const onRegistryChange = () => {
        try {
          const ops = opts.registry.getActive().map((op) => ({
            id: op.id, name: op.name, role: op.role, status: op.status, task: op.task,
          }));
          res.write(`data: ${JSON.stringify({ type: "operators", operators: ops })}\n\n`);
        } catch { /* client gone */ }
      };
      const regDispose = opts.registry.onDidChange(onRegistryChange);

      // Forward drive mode changes
      const onModeChange = (state: { active: boolean; subMode: string }) => {
        try {
          res.write(`data: ${JSON.stringify({ type: "mode", active: state.active, subMode: state.subMode })}\n\n`);
        } catch { /* client gone */ }
      };
      opts.driveMode.on("change", onModeChange);

      req.on("close", () => {
        clearInterval(heartbeat);
        agentOutput.removeListener("event", onEvent);
        regDispose.dispose();
        opts.driveMode.off("change", onModeChange);
      });
      return;
    }

    // ── GET /dashboard — Serve static dashboard HTML ───────────────────────
    if (req.method === "GET" && parsedUrl.pathname === "/dashboard") {
      const thisDir = path.dirname(fileURLToPath(import.meta.url));
      const htmlPath = path.join(thisDir, "..", "public", "index.html");
      try {
        const html = await fsp.readFile(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" });
        res.end(html);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Dashboard not found");
      }
      return;
    }

    // Reject MCP tool calls while draining
    if (draining && req.method === "POST") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Server is shutting down" }));
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST") {
      const id = sessionId ?? `session-${Date.now()}`;
      let entry = sessions.get(id);
      if (!entry) {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => id });
        const server = buildMcpServer(opts);
        await server.connect(transport);
        entry = { transport, server };
        sessions.set(id, entry);
      }
      await entry.transport.handleRequest(req, res);
    } else if (req.method === "GET" && sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) { res.writeHead(404); res.end(); return; }
      await entry.transport.handleRequest(req, res);
    } else if (req.method === "DELETE" && sessionId) {
      sessions.delete(sessionId);
      res.writeHead(200); res.end();
    } else {
      res.writeHead(405); res.end();
    }
  });

  // Try port, port+1, ... port+(portRange-1)
  let boundPort: number | undefined;
  for (let attempt = 0; attempt < portRange; attempt++) {
    const candidatePort = port + attempt;
    const ok = await new Promise<boolean>((resolve) => {
      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          resolve(false);
        } else {
          resolve(false);
          console.error(`[claude-drive] Port error: ${err.message}`);
        }
      });
      httpServer.listen(candidatePort, "127.0.0.1", () => resolve(true));
    });
    if (ok) {
      const addr = httpServer.address();
      boundPort = (typeof addr === "object" && addr !== null) ? addr.port : candidatePort;
      break;
    }
  }

  if (boundPort === undefined) {
    throw new Error(`[claude-drive] Could not bind to any port in range ${port}–${port + portRange - 1}`);
  }

  writePortFile(boundPort);

  const cleanup = () => {
    deletePortFile();
    if (opts.commsAgent) {
      try { opts.commsAgent.dispose(); } catch { /* best-effort */ }
    }
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("exit", cleanup);

  console.log(`[claude-drive] MCP server listening on http://127.0.0.1:${boundPort}/mcp`);
  console.log(`[claude-drive] Dashboard: http://127.0.0.1:${boundPort}/dashboard`);
  console.log(`[claude-drive] Port file: ${getPortFilePath()}`);
  return {
    port: boundPort,
    close: () => {
      httpServer.close();
      cleanup();
    },
  };
}
