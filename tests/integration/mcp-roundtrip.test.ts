/**
 * tests/integration/mcp-roundtrip.test.ts — MCP server round-trip integration test.
 * Starts the HTTP MCP server on a random port, exercises tool calls via JSON-RPC.
 */
import http from "http";
import { startMcpServer } from "../../src/mcpServer.js";
import { OperatorRegistry } from "../../src/operatorRegistry.js";
import { createDriveModeManager } from "../../src/driveMode.js";

let boundPort: number;
let closeServer: () => void;
const registry = new OperatorRegistry();
const driveMode = createDriveModeManager();

function jsonRpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

/** Parse SSE response body to extract JSON-RPC data lines */
function parseSseJson(body: string): unknown {
  // SSE format: "event: message\ndata: {...}\n\n"
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6));
      } catch { /* skip non-JSON data lines */ }
    }
  }
  // Fallback: try parsing as plain JSON
  return JSON.parse(body);
}

function post(
  port: number,
  body: string,
  sessionId?: string,
): Promise<{ status: number; body: string; json: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const req = http.request(
      { hostname: "127.0.0.1", port, path: "/mcp", method: "POST", headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let json: unknown;
          try { json = parseSseJson(data); } catch { json = null; }
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            json,
            headers: res.headers,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function get(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    }).on("error", reject);
  });
}

beforeAll(async () => {
  driveMode.setActive(true);
  const result = await startMcpServer({ port: 0, registry, driveMode });
  boundPort = result.port;
  closeServer = result.close;
}, 15_000);

afterAll(() => {
  closeServer?.();
});

describe("MCP round-trip", () => {
  let sessionId: string | undefined;

  it("health endpoint returns ok", async () => {
    const res = await get(boundPort, "/health");
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe("ok");
    expect(typeof json.uptime).toBe("number");
    expect(json.port).toBe(boundPort);
  });

  it("initialize session", async () => {
    const res = await post(boundPort, jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    }));
    expect(res.status).toBe(200);
    sessionId = res.headers["mcp-session-id"] as string | undefined;
    const json = res.json as Record<string, unknown>;
    expect(json).toBeDefined();
    const result = json.result as Record<string, unknown> | undefined;
    expect(result).toBeDefined();
  });

  it("tools/list returns expected tools", async () => {
    expect(sessionId).toBeDefined();
    const res = await post(boundPort, jsonRpc("tools/list", {}, 2), sessionId);
    expect(res.status).toBe(200);
    const json = res.json as Record<string, unknown>;
    const result = json.result as Record<string, unknown>;
    const tools = (result?.tools ?? []) as Array<{ name: string }>;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("operator_spawn");
    expect(toolNames).toContain("operator_list");
    expect(toolNames).toContain("operator_dismiss");
    expect(toolNames).toContain("drive_get_state");
    expect(toolNames).toContain("drive_run_task");
    expect(toolNames).toContain("tts_speak");
    expect(toolNames).toContain("worktree_create");
  });

  it("operator_spawn creates an operator", async () => {
    expect(sessionId).toBeDefined();
    const res = await post(boundPort, jsonRpc("tools/call", {
      name: "operator_spawn",
      arguments: { name: "TestOp", role: "researcher", preset: "readonly" },
    }, 3), sessionId);
    expect(res.status).toBe(200);
    const json = res.json as Record<string, unknown>;
    const result = json.result as Record<string, unknown>;
    const content = (result?.content as Array<{ text: string }>) ?? [];
    expect(content[0]?.text).toContain("TestOp");
  });

  it("operator_list shows spawned operator", async () => {
    expect(sessionId).toBeDefined();
    const res = await post(boundPort, jsonRpc("tools/call", {
      name: "operator_list",
      arguments: {},
    }, 4), sessionId);
    expect(res.status).toBe(200);
    const json = res.json as Record<string, unknown>;
    const result = json.result as Record<string, unknown>;
    const content = (result?.content as Array<{ text: string }>) ?? [];
    expect(content[0]?.text).toContain("TestOp");
  });

  it("operator_dismiss removes the operator", async () => {
    expect(sessionId).toBeDefined();
    const res = await post(boundPort, jsonRpc("tools/call", {
      name: "operator_dismiss",
      arguments: { nameOrId: "TestOp" },
    }, 5), sessionId);
    expect(res.status).toBe(200);
    const json = res.json as Record<string, unknown>;
    const result = json.result as Record<string, unknown>;
    const content = (result?.content as Array<{ text: string }>) ?? [];
    expect(content[0]?.text).toContain("Dismissed");
  });

  it("operator_list is empty after dismiss", async () => {
    expect(sessionId).toBeDefined();
    const res = await post(boundPort, jsonRpc("tools/call", {
      name: "operator_list",
      arguments: {},
    }, 6), sessionId);
    expect(res.status).toBe(200);
    const json = res.json as Record<string, unknown>;
    const result = json.result as Record<string, unknown>;
    const content = (result?.content as Array<{ text: string }>) ?? [];
    expect(content[0]?.text).toContain("No active operators");
  });
});
