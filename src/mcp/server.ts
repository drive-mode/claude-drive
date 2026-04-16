/**
 * mcp/server.ts — MCP server factory + HTTP / stdio transport.
 *
 * All tool definitions live in `./tools.ts` behind `registerAllTools`.
 * This file owns only:
 *   - building a bare `McpServer` + attaching tools
 *   - HTTP port binding (with sequential fallback)
 *   - port-file lifecycle
 *   - stdio transport for the Claude Desktop plugin path
 */
import http from "http";
import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { OperatorRegistry } from "../operatorRegistry.js";
import type { DriveModeManager } from "../driveMode.js";
import type { OnTaskComplete } from "../operatorManager.js";
import type { WorktreeManager } from "../worktreeManager.js";
import type { GitService } from "../gitService.js";
import type { AutoDreamDaemon } from "../autoDream.js";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { portFile } from "../paths.js";
import { registerAllTools } from "./tools.js";

export function getPortFilePath(): string {
  return portFile();
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
  onTaskComplete?: OnTaskComplete;
  dreamDaemon?: AutoDreamDaemon;
}

/** Build a fully-configured McpServer instance with every claude-drive tool. */
export function buildMcpServer(opts: McpServerOptions): McpServer {
  const server = new McpServer({ name: "claude-drive", version: "0.1.0" });
  registerAllTools(server, opts);
  return server;
}

// Map of sessionId → { transport, server }
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

export async function startMcpServerStdio(opts: Omit<McpServerOptions, "port">): Promise<void> {
  const server = buildMcpServer({ ...opts, port: 0 });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[claude-drive] MCP server running over stdio\n");
}

export async function startMcpServer(opts: McpServerOptions): Promise<{ port: number }> {
  const { port } = opts;
  const portRange: number = getConfig<number>("mcp.portRange") ?? 5;

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
          logger.error(`[claude-drive] Port error: ${err.message}`);
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

  const cleanup = (): void => { deletePortFile(); };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("exit", cleanup);

  logger.info(`[claude-drive] MCP server listening on http://127.0.0.1:${boundPort}/mcp`);
  logger.info(`[claude-drive] Port file: ${getPortFilePath()}`);
  return { port: boundPort };
}
