/**
 * mcpServer.ts — MCP server for claude-drive.
 * Exposes Drive tools to Claude Code CLI on localhost:<port>/mcp.
 * Adapted from cursor-drive: removed vscode deps, wired to agentOutput + config.
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
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
}

// Map of sessionId → { transport, server }
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

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
  }, async ({ task, operatorName, role, preset }) => {
    let op = operatorName ? registry.findByNameOrId(operatorName) : registry.getForeground();
    if (!op) {
      op = registry.spawn(operatorName, task, { role, preset });
    }
    void runOperator(op, task, { allOperators: registry.getActive() });
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

  return server;
}

export async function startMcpServerStdio(opts: Omit<McpServerOptions, "port">): Promise<void> {
  const server = buildMcpServer({ ...opts, port: 0 });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[claude-drive] MCP server running over stdio\n");
}

export async function startMcpServer(opts: McpServerOptions): Promise<{ port: number }> {
  const { port } = opts;
  const portRange: number = (await import("./config.js")).getConfig<number>("mcp.portRange") ?? 5;

  const httpServer = http.createServer(async (req, res) => {
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
      boundPort = candidatePort;
      break;
    }
  }

  if (boundPort === undefined) {
    throw new Error(`[claude-drive] Could not bind to any port in range ${port}–${port + portRange - 1}`);
  }

  writePortFile(boundPort);

  const cleanup = () => {
    deletePortFile();
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("exit", cleanup);

  console.log(`[claude-drive] MCP server listening on http://127.0.0.1:${boundPort}/mcp`);
  console.log(`[claude-drive] Port file: ${getPortFilePath()}`);
  return { port: boundPort };
}
