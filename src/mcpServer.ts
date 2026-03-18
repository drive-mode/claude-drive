/**
 * mcpServer.ts — MCP server for claude-drive.
 * Exposes Drive tools to Claude Code CLI on localhost:<port>/mcp.
 * Adapted from cursor-drive: removed vscode deps, wired to agentOutput + config.
 *
 * TODO: Port all ~65 tools from cursor-drive/src/mcpServer.ts.
 * This file currently implements the MVP subset:
 *   operator_spawn, operator_switch, operator_dismiss, operator_list
 *   agent_screen_activity, agent_screen_file, agent_screen_decision, agent_screen_clear
 *   tts_speak, tts_stop
 *   drive_set_mode
 */
import http from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { OperatorRegistry } from "./operatorRegistry.js";
import type { DriveModeManager } from "./driveMode.js";
import { logActivity, logFile, logDecision, agentOutput } from "./agentOutput.js";
import { speak, stop as ttsStop } from "./tts.js";

export interface McpServerOptions {
  port: number;
  registry: OperatorRegistry;
  driveMode: DriveModeManager;
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

  return server;
}

export async function startMcpServer(opts: McpServerOptions): Promise<void> {
  const { port } = opts;

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

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, "127.0.0.1", () => resolve());
    httpServer.on("error", reject);
  });

  console.log(`[claude-drive] MCP server listening on http://127.0.0.1:${port}/mcp`);
}
