/**
 * mcp/tools.ts — All MCP tool registrations.
 *
 * `registerAllTools(server, opts)` attaches every tool to a fresh `McpServer`
 * instance. The tool bodies are identical to the pre-split layout; only the
 * containing function moved. Tests that count registered tools by name
 * (`mcpServer.test.ts`) continue to pass unchanged.
 *
 * All business-logic imports stay here so `mcp/server.ts` holds only
 * transport + port-bind concerns.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OperatorRegistry } from "../operatorRegistry.js";
import type { DriveModeManager } from "../driveMode.js";
import { getConfig } from "../config.js";
import { logActivity, logFile, logDecision, agentOutput } from "../agentOutput.js";
import { speak, stop as ttsStop } from "../tts.js";
import { runOperator } from "../operatorManager.js";
import type { OnTaskComplete } from "../operatorManager.js";
import { readProgressSnapshot } from "../progressFile.js";
import { runBestOfN } from "../bestOfN.js";
import {
  loadAgentDefinitions,
  getAgentDefinition,
  applyAgentDefinition,
} from "../agentDefinitionLoader.js";
import { listPendingApprovals, respondToApproval } from "../approvalQueue.js";
import type { WorktreeManager } from "../worktreeManager.js";
import type { GitService } from "../gitService.js";
import { remember, recall, correct, forget, shareMemory } from "../memoryManager.js";
import { memoryStore } from "../memoryStore.js";
import type { MemoryKind } from "../memoryStore.js";
import { hookRegistry } from "../hooks.js";
import type { HookEvent } from "../hooks.js";
import { skillRegistry } from "../skillLoader.js";
import {
  createCheckpoint, restoreCheckpoint, listCheckpoints, forkSession,
} from "../checkpoint.js";
import type { AutoDreamDaemon } from "../autoDream.js";
import { logger } from "../logger.js";
import {
  getReflectionRules, getDefaultRules, addReflectionRule,
  removeReflectionRule, toggleReflectionRule,
} from "../reflectionGate.js";
import type { ReflectionHookEvent } from "../reflectionGate.js";
import {
  loadScenarios, loadScenariosByTag, buildEvalResult, buildSuiteResult,
  compareResults, saveResult, loadResults,
} from "../evaluationHarness.js";
import {
  startOptimization, stopOptimization, getOptimizationStatus,
  listOptimizationRuns, getOptimizationSummary, ALL_MUTATION_OPERATORS,
} from "../promptOptimizer.js";

export interface McpToolDeps {
  registry: OperatorRegistry;
  driveMode: DriveModeManager;
  worktreeManager?: WorktreeManager;
  gitService?: GitService;
  sessionId?: string;
  onTaskComplete?: OnTaskComplete;
  dreamDaemon?: AutoDreamDaemon;
}

export function registerAllTools(server: McpServer, opts: McpToolDeps): void {
  const { registry, driveMode } = opts;

  // ── Operator tools ────────────────────────────────────────────────────────

  server.tool("operator_spawn", "Spawn a new named operator", {
    name: z.string().optional(),
    task: z.string().optional(),
    role: z.enum(["implementer", "reviewer", "tester", "researcher", "planner"]).optional(),
    preset: z.enum(["readonly", "standard", "full"]).optional(),
    parentId: z.string().optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    executionMode: z.enum(["foreground", "background"]).optional(),
    agent: z.string().optional(),
  }, async ({ name, task, role, preset, parentId, effort, executionMode, agent }) => {
    const merged = applyAgentDefinition<{
      role?: typeof role;
      preset?: typeof preset;
      effort?: typeof effort;
      executionMode?: "foreground" | "background";
      agentDefinitionName?: string;
    }>(agent ?? name, { role, preset, effort, executionMode });
    const op = registry.spawn(name ?? agent, task ?? "", {
      role: merged.options.role,
      preset: merged.options.preset,
      effort: merged.options.effort,
      executionMode: merged.options.executionMode,
      parentId,
      agentDefinitionName: merged.options.agentDefinitionName,
    });
    return { content: [{ type: "text", text: `Spawned operator: ${op.name} (${op.permissionPreset}${op.executionMode === "background" ? ", bg" : ""}${op.parentId ? `, parent=${op.parentId}` : ""})` }] };
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

  // ── Agent Screen tools ────────────────────────────────────────────────────
  //
  // agent_screen_log is the canonical unified entry point; the 5 original
  // per-kind tools remain as back-compat aliases that forward to the
  // appropriate dispatcher. Callers should prefer the unified form; aliases
  // emit a debug-level deprecation notice.

  server.tool("agent_screen_log", "Log an agent-screen event (unified: activity|file|decision|clear|chime)", {
    kind: z.enum(["activity", "file", "decision", "clear", "chime"]),
    agent: z.string().optional(),
    text: z.string().optional(),
    path: z.string().optional(),
    action: z.string().optional(),
    name: z.string().optional(),
  }, async ({ kind, agent, text, path, action, name }) => {
    switch (kind) {
      case "activity":
        if (!agent || !text) return { content: [{ type: "text", text: "activity requires {agent, text}" }], isError: true };
        logActivity(agent, text);
        return { content: [{ type: "text", text: "logged" }] };
      case "file":
        if (!agent || !path) return { content: [{ type: "text", text: "file requires {agent, path}" }], isError: true };
        logFile(agent, path, action);
        return { content: [{ type: "text", text: "logged" }] };
      case "decision":
        if (!agent || !text) return { content: [{ type: "text", text: "decision requires {agent, text}" }], isError: true };
        logDecision(agent, text);
        return { content: [{ type: "text", text: "logged" }] };
      case "clear":
        agentOutput.emit("event", { type: "clear" });
        return { content: [{ type: "text", text: "cleared" }] };
      case "chime":
        agentOutput.emit("event", { type: "chime", name });
        return { content: [{ type: "text", text: "chime" }] };
    }
  });

  server.tool("agent_screen_activity", "Deprecated alias — use agent_screen_log kind=activity", {
    agent: z.string(),
    text: z.string(),
  }, async ({ agent, text }) => {
    logger.debug("[mcp] agent_screen_activity is deprecated; use agent_screen_log.");
    logActivity(agent, text);
    return { content: [{ type: "text", text: "logged" }] };
  });

  server.tool("agent_screen_file", "Deprecated alias — use agent_screen_log kind=file", {
    agent: z.string(),
    path: z.string(),
    action: z.string().optional(),
  }, async ({ agent, path, action }) => {
    logger.debug("[mcp] agent_screen_file is deprecated; use agent_screen_log.");
    logFile(agent, path, action);
    return { content: [{ type: "text", text: "logged" }] };
  });

  server.tool("agent_screen_decision", "Deprecated alias — use agent_screen_log kind=decision", {
    agent: z.string(),
    text: z.string(),
  }, async ({ agent, text }) => {
    logger.debug("[mcp] agent_screen_decision is deprecated; use agent_screen_log.");
    logDecision(agent, text);
    return { content: [{ type: "text", text: "logged" }] };
  });

  server.tool("agent_screen_clear", "Deprecated alias — use agent_screen_log kind=clear", {}, async () => {
    logger.debug("[mcp] agent_screen_clear is deprecated; use agent_screen_log.");
    agentOutput.emit("event", { type: "clear" });
    return { content: [{ type: "text", text: "cleared" }] };
  });

  server.tool("agent_screen_chime", "Deprecated alias — use agent_screen_log kind=chime", {
    name: z.string().optional(),
  }, async ({ name }) => {
    logger.debug("[mcp] agent_screen_chime is deprecated; use agent_screen_log.");
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

  server.tool("drive_set_mode", "Set the drive sub-mode", {
    mode: z.enum(["plan", "agent", "ask", "debug", "off"]),
  }, async ({ mode }) => {
    driveMode.setSubMode(mode);
    return { content: [{ type: "text", text: `Mode set to ${mode}` }] };
  });

  // ── Drive run / state tools ───────────────────────────────────────────────

  server.tool("drive_run_task", "Dispatch a task to an operator", {
    task: z.string(),
    operatorName: z.string().optional(),
    role: z.enum(["implementer", "reviewer", "tester", "researcher", "planner"]).optional(),
    preset: z.enum(["readonly", "standard", "full"]).optional(),
    background: z.boolean().optional(),
    taskBudget: z.number().optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    parentId: z.string().optional(),
    agent: z.string().optional(),
  }, async ({ task, operatorName, role, preset, background, taskBudget, effort, parentId, agent }) => {
    const maxConcurrent = getConfig<number>("operators.maxConcurrent") ?? 3;
    const activeCount = registry.getActive().filter((o) => o.status === "active" || o.status === "background").length;
    if (activeCount >= maxConcurrent) {
      return { content: [{ type: "text", text: `Cannot dispatch: ${activeCount} operators active (max ${maxConcurrent}). Dismiss an operator first.` }], isError: true };
    }

    const merged = applyAgentDefinition<{
      role?: typeof role;
      preset?: typeof preset;
      effort?: typeof effort;
      executionMode?: "foreground" | "background";
      agentDefinitionName?: string;
    }>(agent ?? operatorName, {
      role,
      preset,
      effort,
      executionMode: background ? ("background" as const) : undefined,
    });

    let op = operatorName ? registry.findByNameOrId(operatorName) : registry.getForeground();
    if (!op) {
      op = registry.spawn(operatorName ?? agent, task, {
        role: merged.options.role,
        preset: merged.options.preset,
        effort: merged.options.effort,
        executionMode: merged.options.executionMode,
        parentId,
        agentDefinitionName: merged.options.agentDefinitionName,
      });
    }
    const isBackground = (background ?? (merged.options.executionMode === "background")) === true;
    runOperator(op, task, {
      allOperators: registry.getActive(),
      onTaskComplete: opts.onTaskComplete,
      registry,
      isBackground,
      taskBudget,
      effort: merged.options.effort,
    }).catch((e) => logger.error(`[drive_run_task] Error in operator ${op!.name}:`, e));
    return { content: [{ type: "text", text: `Task ${isBackground ? "dispatched (background)" : "dispatched"} to ${op.name}: ${task}` }] };
  });

  server.tool("operator_get_progress", "Read the latest background progress snapshot for an operator", {
    nameOrId: z.string(),
  }, async ({ nameOrId }) => {
    const op = registry.findByNameOrId(nameOrId);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${nameOrId}` }], isError: true };
    const snap = readProgressSnapshot(op.id);
    return { content: [{ type: "text", text: JSON.stringify(snap, null, 2) }] };
  });

  server.tool("operator_await", "Block until an operator's in-flight run completes", {
    nameOrId: z.string(),
    timeoutMs: z.number().optional(),
  }, async ({ nameOrId, timeoutMs }) => {
    const op = registry.findByNameOrId(nameOrId);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${nameOrId}` }], isError: true };
    const timeout = timeoutMs ?? getConfig<number>("operator.awaitTimeoutMs") ?? 300000;

    let timedOut = false;
    const timer = new Promise<"timeout">((resolve) => {
      setTimeout(() => { timedOut = true; resolve("timeout"); }, timeout);
    });

    if (op.runPromise) {
      const outcome = await Promise.race([
        op.runPromise.then(() => "done" as const).catch(() => "done" as const),
        timer,
      ]);
      if (outcome === "timeout") {
        return { content: [{ type: "text", text: `Timed out after ${timeout}ms waiting for ${op.name}` }], isError: true };
      }
    } else {
      while (op.status !== "completed" && op.status !== "merged") {
        if (timedOut) {
          return { content: [{ type: "text", text: `Timed out after ${timeout}ms waiting for ${op.name}` }], isError: true };
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    const snap = readProgressSnapshot(op.id);
    const payload = { status: op.status, stats: op.stats, lastProgress: snap.last };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  });

  server.tool("operator_context_usage", "Get cached context-window usage for an operator", {
    nameOrId: z.string(),
  }, async ({ nameOrId }) => {
    const op = registry.findByNameOrId(nameOrId);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${nameOrId}` }], isError: true };
    if (!op.contextUsage) return { content: [{ type: "text", text: `No context usage recorded for ${op.name}.` }] };
    return { content: [{ type: "text", text: JSON.stringify(op.contextUsage, null, 2) }] };
  });

  server.tool("operator_tree", "Return the operator hierarchy as JSON", {
    rootNameOrId: z.string().optional(),
  }, async ({ rootNameOrId }) => {
    const tree = registry.getTree(rootNameOrId);
    const serialize = (nodes: Array<{ op: { id: string; name: string; status: string; role?: string; depth: number; permissionPreset: string; executionMode?: string; agentDefinitionName?: string }; children: unknown[] }>): unknown =>
      nodes.map((n) => ({
        id: n.op.id,
        name: n.op.name,
        status: n.op.status,
        role: n.op.role,
        depth: n.op.depth,
        preset: n.op.permissionPreset,
        executionMode: n.op.executionMode,
        agentDefinitionName: n.op.agentDefinitionName,
        children: serialize(n.children as Array<{ op: never; children: unknown[] }>),
      }));
    return { content: [{ type: "text", text: JSON.stringify(serialize(tree as Parameters<typeof serialize>[0]), null, 2) }] };
  });

  server.tool("agent_list", "List configured agent definitions (builtin + user + project)", {}, async () => {
    const defs = loadAgentDefinitions();
    if (defs.length === 0) return { content: [{ type: "text", text: "No agent definitions." }] };
    const lines = defs.map((d) =>
      `${d.name} [${d.scope ?? "user"}] — ${d.description}${d.role ? ` role=${d.role}` : ""}${d.preset ? ` preset=${d.preset}` : ""}${d.background ? " background" : ""}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool("agent_inspect", "Show a single resolved agent definition", {
    name: z.string(),
  }, async ({ name }) => {
    const def = getAgentDefinition(name);
    if (!def) return { content: [{ type: "text", text: `Agent not found: ${name}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(def, null, 2) }] };
  });

  server.tool("drive_best_of_n", "Spawn N operators in parallel and pick the best result", {
    task: z.string(),
    count: z.number().optional(),
    models: z.array(z.string()).optional(),
    role: z.enum(["implementer", "reviewer", "tester", "researcher", "planner"]).optional(),
    preset: z.enum(["readonly", "standard", "full"]).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  }, async ({ task, count, models, role, preset, effort }) => {
    try {
      const result = await runBestOfN(task, registry, { count, models, role, preset, effort });
      const summary = result.all.map((r, i) => {
        const winner = i === result.winnerIndex ? " ★" : "";
        const stats = r.stats ? ` cost=$${r.stats.totalCostUsd.toFixed(4)} turns=${r.stats.numTurns}` : "";
        const err = r.error ? ` error="${r.error}"` : "";
        const summaryTxt = r.lastSummary ? ` summary="${r.lastSummary}"` : "";
        return `#${i + 1}${winner} ${r.op.name} success=${r.success}${stats}${err}${summaryTxt}`;
      }).join("\n");
      return { content: [{ type: "text", text: summary }] };
    } catch (e) {
      return { content: [{ type: "text", text: `best-of-N failed: ${e instanceof Error ? e.message : e}` }], isError: true };
    }
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
    const { createSession } = await import("../sessionManager.js");
    const id = createSession(registry, driveMode, name);
    return { content: [{ type: "text", text: `Session saved: ${id}` }] };
  });

  server.tool("session_restore", "Restore operators from a saved session", {
    id: z.string(),
  }, async ({ id }) => {
    const { resumeSession } = await import("../sessionManager.js");
    const ok = resumeSession(id, registry, driveMode);
    return { content: [{ type: "text", text: ok ? `Restored session: ${id}` : `Session not found: ${id}` }] };
  });

  server.tool("session_list", "List all saved sessions", {}, async () => {
    const { listSessions } = await import("../sessionManager.js");
    const slist = listSessions();
    if (slist.length === 0) return { content: [{ type: "text", text: "No saved sessions." }] };
    const text = slist.map((s) => {
      const date = new Date(s.createdAt).toLocaleString();
      const opCount = s.operators.filter((o) => o.status !== "completed").length;
      return `${s.id}  ${s.name ?? "(unnamed)"}  ${date}  ${opCount} operator(s)`;
    }).join("\n");
    return { content: [{ type: "text", text }] };
  });

  // ── Cost / stats tools ────────────────────────────────────────────────────

  server.tool("drive_get_costs", "Get cost and stats for all operators and plans", {}, async () => {
    const totals = registry.getTotalStats();
    const all = registry.list();
    const lines: string[] = [];
    lines.push("=== Operator Costs ===");
    for (const op of all) {
      const s = op.stats;
      if (s.taskCount === 0) {
        lines.push(`  ${op.name} [${op.status}]: no tasks completed`);
      } else {
        lines.push(`  ${op.name} [${op.status}]: $${s.totalCostUsd.toFixed(4)} | ${s.totalTurns} turns | ${s.taskCount} task(s) | ${Math.round(s.totalDurationMs / 1000)}s`);
      }
    }
    lines.push(`\n=== Totals ===`);
    lines.push(`  Cost: $${totals.totalCostUsd.toFixed(4)} | Turns: ${totals.totalTurns} | Tasks: ${totals.taskCount}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool("operator_record_cost", "Record task cost stats for an operator", {
    nameOrId: z.string(),
    costUsd: z.number(),
    durationMs: z.number(),
    apiDurationMs: z.number().optional(),
    turns: z.number(),
  }, async ({ nameOrId, costUsd, durationMs, apiDurationMs, turns }) => {
    const ok = registry.recordTaskStats(nameOrId, costUsd, durationMs, apiDurationMs ?? 0, turns);
    return { content: [{ type: "text", text: ok ? `Recorded: $${costUsd.toFixed(4)} for ${nameOrId}` : `Operator not found: ${nameOrId}` }] };
  });

  // ── Memory tools ──────────────────────────────────────────────────────────

  server.tool("memory_remember", "Store a typed memory entry for an operator", {
    operatorName: z.string(),
    kind: z.enum(["fact", "preference", "correction", "decision", "context"]),
    content: z.string(),
    tags: z.array(z.string()).optional(),
  }, async ({ operatorName, kind, content, tags }) => {
    const op = registry.findByNameOrId(operatorName);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${operatorName}` }], isError: true };
    const entry = remember(op.id, kind as MemoryKind, content, tags);
    return { content: [{ type: "text", text: `Remembered [${kind}]: ${entry.id}` }] };
  });

  server.tool("memory_recall", "Query memory entries", {
    operatorName: z.string().optional(),
    kinds: z.array(z.enum(["fact", "preference", "correction", "decision", "context"])).optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().optional(),
    limit: z.number().optional(),
  }, async ({ operatorName, kinds, tags, search, limit }) => {
    const op = operatorName ? registry.findByNameOrId(operatorName) : undefined;
    const entries = recall(op?.id, {
      kinds: kinds as MemoryKind[] | undefined,
      tags,
      search,
      limit: limit ?? 20,
    });
    if (entries.length === 0) return { content: [{ type: "text", text: "No memories found." }] };
    const text = entries.map((e) =>
      `[${e.kind}] (${e.id.slice(0, 8)}) conf=${e.confidence.toFixed(2)} ${e.operatorId ? "" : "(shared)"} ${e.content}`
    ).join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("memory_correct", "Supersede a memory entry with corrected content", {
    operatorName: z.string(),
    oldId: z.string(),
    newContent: z.string(),
  }, async ({ operatorName, oldId, newContent }) => {
    const op = registry.findByNameOrId(operatorName);
    if (!op) return { content: [{ type: "text", text: `Operator not found: ${operatorName}` }], isError: true };
    const entry = correct(op.id, oldId, newContent);
    if (!entry) return { content: [{ type: "text", text: `Memory entry not found: ${oldId}` }], isError: true };
    return { content: [{ type: "text", text: `Corrected: ${entry.id} supersedes ${oldId}` }] };
  });

  server.tool("memory_forget", "Remove a memory entry", {
    id: z.string(),
  }, async ({ id }) => {
    const ok = forget(id);
    return { content: [{ type: "text", text: ok ? `Forgotten: ${id}` : `Not found: ${id}` }] };
  });

  server.tool("memory_share", "Promote an operator memory to shared/global", {
    id: z.string(),
  }, async ({ id }) => {
    const ok = shareMemory(id);
    return { content: [{ type: "text", text: ok ? `Shared: ${id}` : `Not found: ${id}` }] };
  });

  // ── Hook tools ───────────────────────────────────────────────────────────
  //
  // hooks_register and hooks_unregister are intentionally NOT exposed as MCP
  // tools — hooks with type "command" can execute arbitrary shell commands,
  // so registration is restricted to trusted sources (the user's config file
  // and `~/.claude-drive/hooks/` directory). `hooks_list` is read-only and
  // safe to expose.

  server.tool("hooks_list", "List registered hooks", {
    event: z.string().optional(),
  }, async ({ event }) => {
    const hooks = hookRegistry.list(event as HookEvent | undefined);
    if (hooks.length === 0) return { content: [{ type: "text", text: "No hooks registered." }] };
    const text = hooks.map((h) =>
      `${h.id} [${h.event}] ${h.type}${h.matcher ? ` matcher=${h.matcher}` : ""} priority=${h.priority ?? 100}`
    ).join("\n");
    return { content: [{ type: "text", text }] };
  });

  // ── Skill tools ──────────────────────────────────────────────────────────

  server.tool("skill_list", "List available skills", {}, async () => {
    const skills = skillRegistry.list();
    if (skills.length === 0) return { content: [{ type: "text", text: "No skills available. Add .md files to ~/.claude-drive/skills/" }] };
    const text = skills.map((s) =>
      `${s.name}: ${s.description}${s.tags ? ` [${s.tags.join(", ")}]` : ""}${s.parameters ? ` params: ${s.parameters.map((p) => p.name).join(", ")}` : ""}`
    ).join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("skill_load", "Load a skill and return its resolved prompt", {
    name: z.string(),
    params: z.record(z.string(), z.string()).optional(),
  }, async ({ name, params }) => {
    try {
      const prompt = skillRegistry.resolve(name, params as Record<string, string> | undefined);
      if (!prompt) return { content: [{ type: "text", text: `Skill not found: ${name}` }], isError: true };
      return { content: [{ type: "text", text: prompt }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
    }
  });

  server.tool("skill_run", "Load a skill and dispatch to an operator", {
    name: z.string(),
    operatorName: z.string().optional(),
    params: z.record(z.string(), z.string()).optional(),
  }, async ({ name, operatorName, params }) => {
    try {
      const prompt = skillRegistry.resolve(name, params as Record<string, string> | undefined);
      if (!prompt) return { content: [{ type: "text", text: `Skill not found: ${name}` }], isError: true };
      const skill = skillRegistry.get(name)!;
      let op = operatorName ? registry.findByNameOrId(operatorName) : registry.getForeground();
      if (!op) {
        op = registry.spawn(operatorName ?? name, prompt, {
          role: skill.requiredRole,
          preset: skill.requiredPreset,
        });
      }
      runOperator(op, prompt, { allOperators: registry.getActive(), onTaskComplete: opts.onTaskComplete })
        .catch((e) => logger.error(`[skill_run] Error in operator ${op!.name}:`, e));
      return { content: [{ type: "text", text: `Skill "${name}" dispatched to ${op.name}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
    }
  });

  // ── Enhanced Session / Checkpoint tools ──────────────────────────────────

  server.tool("session_checkpoint", "Create a checkpoint of current state", {
    name: z.string().optional(),
    description: z.string().optional(),
  }, async ({ name, description }) => {
    const sessionId = opts.sessionId ?? `session-${Date.now()}`;
    const cp = createCheckpoint(sessionId, registry, driveMode, [], name, description);
    return { content: [{ type: "text", text: `Checkpoint created: ${cp.id}${name ? ` (${name})` : ""}` }] };
  });

  server.tool("session_restore_checkpoint", "Restore state from a checkpoint", {
    checkpointId: z.string(),
  }, async ({ checkpointId }) => {
    const result = restoreCheckpoint(checkpointId, registry, driveMode);
    return { content: [{ type: "text", text: result.ok ? `Restored checkpoint: ${checkpointId}` : `Checkpoint not found: ${checkpointId}` }] };
  });

  server.tool("session_list_checkpoints", "List all checkpoints", {
    sessionId: z.string().optional(),
  }, async ({ sessionId }) => {
    const checkpoints = listCheckpoints(sessionId);
    if (checkpoints.length === 0) return { content: [{ type: "text", text: "No checkpoints found." }] };
    const text = checkpoints.map((cp) => {
      const date = new Date(cp.createdAt).toLocaleString();
      const opCount = cp.operators.filter((o) => o.status !== "completed").length;
      return `${cp.id}  ${cp.name ?? "(unnamed)"}  ${date}  ${opCount} ops  ${cp.memory.length} memories`;
    }).join("\n");
    return { content: [{ type: "text", text }] };
  });

  server.tool("session_fork", "Fork current session (optionally from a checkpoint)", {
    checkpointId: z.string().optional(),
    newName: z.string().optional(),
  }, async ({ checkpointId, newName }) => {
    const sessionId = opts.sessionId ?? `session-${Date.now()}`;
    try {
      const result = forkSession(sessionId, registry, driveMode, [], checkpointId, newName);
      return { content: [{ type: "text", text: `Forked session: ${result.newSessionId}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Fork failed: ${e}` }], isError: true };
    }
  });

  server.tool("session_metadata", "Set metadata on the current session", {
    key: z.string(),
    value: z.string(),
  }, async ({ key, value }) => {
    const { store } = await import("../store.js");
    store.update(`session.metadata.${key}`, value);
    return { content: [{ type: "text", text: `Metadata set: ${key} = ${value}` }] };
  });

  // ── Dream tools ──────────────────────────────────────────────────────────

  server.tool("dream_trigger", "Manually trigger a dream consolidation cycle", {}, async () => {
    if (opts.dreamDaemon) {
      const result = opts.dreamDaemon.runOnce();
      return { content: [{ type: "text", text: result.summary }] };
    }
    const { runDreamCycle } = await import("../autoDream.js");
    const result = runDreamCycle();
    return { content: [{ type: "text", text: result.summary }] };
  });

  server.tool("dream_status", "Get auto-dream status and last result", {}, async () => {
    const daemon = opts.dreamDaemon;
    const last = daemon?.getLastResult();
    const lines: string[] = [
      `Auto-dream: ${daemon?.isRunning() ? "running" : "stopped"}`,
    ];
    if (last) {
      lines.push(`Last run: ${new Date(last.timestamp).toLocaleString()}`);
      lines.push(`  ${last.summary}`);
    }
    const stats = memoryStore.stats();
    lines.push(`Memory: ${stats.total} entries`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  // ── Reflection gate tools ──────────────────────────────────────────────

  server.tool("reflection_list", "List active self-reflection rules", {}, async () => {
    const rules = getReflectionRules();
    const defaults = getDefaultRules();
    const lines = rules.map((r) => {
      const isDefault = defaults.some((d) => d.id === r.id);
      return `[${r.hookEvent}] ${r.id}${isDefault ? " (default)" : ""}: ${r.question.slice(0, 80)}${r.roles ? ` (roles: ${r.roles.join(",")})` : ""}`;
    });
    return { content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No active reflection rules." }] };
  });

  server.tool("reflection_add", "Add a custom self-reflection rule", {
    question: z.string().describe("The reflection question to inject"),
    hookEvent: z.enum(["UserPromptSubmit", "PostToolUse", "Stop", "PreToolUse"]).describe("When to fire"),
    roles: z.array(z.string()).optional().describe("Operator roles this applies to"),
    toolMatcher: z.string().optional().describe("Regex for tool name (PreToolUse/PostToolUse)"),
    tags: z.array(z.string()).optional().describe("Tags for filtering"),
    priority: z.number().optional().describe("Lower = fires first"),
  }, async (args) => {
    const rule = addReflectionRule({
      question: args.question,
      hookEvent: args.hookEvent as ReflectionHookEvent,
      roles: args.roles as import("../operatorRegistry.js").OperatorRole[] | undefined,
      toolMatcher: args.toolMatcher,
      tags: args.tags,
      enabled: true,
      priority: args.priority ?? 100,
    });
    return { content: [{ type: "text", text: `Added reflection rule: ${rule.id}` }] };
  });

  server.tool("reflection_remove", "Remove a custom reflection rule", {
    id: z.string().describe("Rule ID to remove"),
  }, async (args) => {
    const removed = removeReflectionRule(args.id);
    return { content: [{ type: "text", text: removed ? `Removed rule: ${args.id}` : `Rule not found: ${args.id}` }] };
  });

  server.tool("reflection_toggle", "Enable or disable a reflection rule", {
    id: z.string().describe("Rule ID"),
    enabled: z.boolean().describe("Enable or disable"),
  }, async (args) => {
    toggleReflectionRule(args.id, args.enabled);
    return { content: [{ type: "text", text: `Rule ${args.id} ${args.enabled ? "enabled" : "disabled"}` }] };
  });

  // ── Evaluation harness tools ──────────────────────────────────────────

  server.tool("evaluation_list", "List available eval scenarios and past results", {
    tag: z.string().optional().describe("Filter scenarios by tag"),
  }, async (args) => {
    const scenarios = args.tag ? loadScenariosByTag(args.tag) : loadScenarios();
    const results = loadResults();
    const lines = [
      `Scenarios: ${scenarios.length}`,
      ...scenarios.map((s) => `  [${s.id}] ${s.name} (${s.expectedBehaviors.length} expected, ${s.forbiddenBehaviors.length} forbidden)`),
      `\nPast results: ${results.length}`,
      ...results.slice(0, 5).map((r) => `  [${r.suiteId}] ${new Date(r.timestamp).toLocaleString()} — pass: ${(r.passRate * 100).toFixed(1)}%, score: ${(r.averageScore * 100).toFixed(1)}%`),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool("evaluation_run", "Run evaluation suite against a prompt", {
    prompt: z.string().describe("The prompt to evaluate"),
    tag: z.string().optional().describe("Run only scenarios with this tag"),
    suiteId: z.string().optional().describe("Suite ID for the result"),
  }, async (args) => {
    const scenarios = args.tag ? loadScenariosByTag(args.tag) : loadScenarios();
    if (scenarios.length === 0) {
      return { content: [{ type: "text", text: "No scenarios found. Add .json files to ~/.claude-drive/eval-scenarios/" }] };
    }
    const results = scenarios.map((s) => buildEvalResult(s, args.prompt, {
      durationMs: 0, costUsd: 0, reflectionFired: [],
    }));
    const suite = buildSuiteResult(args.suiteId ?? `eval-${Date.now()}`, results, args.prompt);
    saveResult(suite);
    const lines = [
      `Suite: ${suite.suiteId}`,
      `Pass rate: ${(suite.passRate * 100).toFixed(1)}%`,
      `Average score: ${(suite.averageScore * 100).toFixed(1)}%`,
      `Scenarios: ${suite.scenarioCount}`,
      ...results.map((r) => `  [${r.scenarioId}] ${r.passed ? "PASS" : "FAIL"} (${(r.score * 100).toFixed(1)}%)`),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool("evaluation_compare", "Compare two eval results", {
    baselineSuiteId: z.string().describe("Baseline suite ID"),
    currentSuiteId: z.string().describe("Current suite ID"),
  }, async (args) => {
    const allResults = loadResults();
    const baseline = allResults.find((r) => r.suiteId === args.baselineSuiteId);
    const current = allResults.find((r) => r.suiteId === args.currentSuiteId);
    if (!baseline || !current) {
      return { content: [{ type: "text", text: "One or both suite results not found." }] };
    }
    const comparison = compareResults(baseline, current);
    return { content: [{ type: "text", text: comparison.details }] };
  });

  // ── Prompt optimizer tools ────────────────────────────────────────────

  server.tool("optimizer_start", "Start autonomous prompt optimization loop", {
    baselinePrompt: z.string().describe("Starting prompt to optimize"),
    maxIterations: z.number().optional().describe("Max iterations (default 20)"),
    tag: z.string().optional().describe("Eval scenario tag to use"),
    improvementThreshold: z.number().optional().describe("Min score delta to keep (default 0.02)"),
  }, async (args) => {
    const scenarios = args.tag ? loadScenariosByTag(args.tag) : loadScenarios();
    if (scenarios.length === 0) {
      return { content: [{ type: "text", text: "No eval scenarios found. Add .json files to ~/.claude-drive/eval-scenarios/" }] };
    }
    const run = await startOptimization({
      maxIterations: args.maxIterations ?? getConfig<number>("optimizer.maxIterations") ?? 20,
      mutationOperators: ALL_MUTATION_OPERATORS,
      baselinePrompt: args.baselinePrompt,
      evalScenarios: scenarios,
      improvementThreshold: args.improvementThreshold ?? getConfig<number>("optimizer.improvementThreshold") ?? 0.02,
      checkpointEvery: getConfig<number>("optimizer.checkpointEvery") ?? 5,
      optimizeReflectionRules: false,
    });
    return { content: [{ type: "text", text: `Optimization started: ${run.id}\nBaseline score: ${(run.baselineScore * 100).toFixed(1)}%` }] };
  });

  server.tool("optimizer_status", "Check optimization progress", {
    runId: z.string().describe("Optimization run ID"),
  }, async (args) => {
    const run = getOptimizationStatus(args.runId);
    if (!run) {
      return { content: [{ type: "text", text: `Optimization run not found: ${args.runId}` }] };
    }
    return { content: [{ type: "text", text: getOptimizationSummary(run) }] };
  });

  server.tool("optimizer_stop", "Stop a running optimization", {
    runId: z.string().describe("Optimization run ID to stop"),
  }, async (args) => {
    const stopped = stopOptimization(args.runId);
    return { content: [{ type: "text", text: stopped ? `Stopped: ${args.runId}` : `Not found or already stopped: ${args.runId}` }] };
  });

  server.tool("optimizer_list", "List all optimization runs", {}, async () => {
    const runs = listOptimizationRuns();
    if (runs.length === 0) {
      return { content: [{ type: "text", text: "No optimization runs." }] };
    }
    const lines = runs.map((r) =>
      `[${r.id}] ${r.status} — iter ${r.currentIteration}/${r.config.maxIterations}, best: ${(r.bestScore * 100).toFixed(1)}%`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool("optimizer_apply", "Get the best prompt from a completed optimization", {
    runId: z.string().describe("Optimization run ID"),
  }, async (args) => {
    const run = getOptimizationStatus(args.runId);
    if (!run) {
      return { content: [{ type: "text", text: `Optimization run not found: ${args.runId}` }] };
    }
    return { content: [{ type: "text", text: `Best prompt (score: ${(run.bestScore * 100).toFixed(1)}%):\n\n${run.bestPrompt}` }] };
  });
}
