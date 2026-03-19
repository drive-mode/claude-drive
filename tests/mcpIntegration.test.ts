/**
 * Integration test for the MCP server.
 * Starts the server on a random port and exercises the JSON-RPC protocol
 * via raw HTTP — no MCP client SDK required.
 */
import http from "http";
import { startMcpServer } from "../src/mcpServer";
import { OperatorRegistry } from "../src/operatorRegistry";
import { createDriveModeManager } from "../src/driveMode";

let server: http.Server;
let baseUrl: string;
let sessionId: string | undefined;

beforeAll(async () => {
  const registry = new OperatorRegistry();
  const driveMode = createDriveModeManager();
  server = await startMcpServer({ port: 0, registry, driveMode });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

/** Low-level HTTP request to the MCP endpoint. */
function rawRequest(method: string, body?: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(baseUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.headers["mcp-session-id"]) {
          sessionId = res.headers["mcp-session-id"] as string;
        }
        resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), headers: res.headers });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Parse an MCP response that may be SSE or plain JSON. */
function parseResponse(raw: string, contentType?: string): any {
  if (contentType?.includes("text/event-stream")) {
    const jsonLines = raw.split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
      .filter(Boolean);
    return jsonLines.length === 1 ? jsonLines[0] : jsonLines;
  }
  try { return JSON.parse(raw); } catch { return raw; }
}

/** Send a JSON-RPC request to the MCP server. */
async function rpc(method: string, params: unknown = {}, id = 1): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  const payload = JSON.stringify({ jsonrpc: "2.0", method, params, id });
  const res = await rawRequest("POST", payload);
  return { ...res, body: parseResponse(res.body, res.headers["content-type"] as string) };
}

/** Send a JSON-RPC notification (no id, no response body expected). */
async function notify(method: string): Promise<number> {
  const payload = JSON.stringify({ jsonrpc: "2.0", method });
  const res = await rawRequest("POST", payload);
  return res.status;
}

describe("MCP server integration", () => {
  it("responds to initialize with serverInfo and capabilities", async () => {
    const { status, body } = await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "integration-test", version: "0.0.1" },
    });
    expect(status).toBe(200);
    expect(body.result).toBeDefined();
    expect(body.result.serverInfo.name).toBe("claude-drive");
    expect(body.result.capabilities).toBeDefined();
  });

  it("accepts initialized notification", async () => {
    const status = await notify("notifications/initialized");
    expect([200, 202, 204]).toContain(status);
  });

  it("lists tools via tools/list", async () => {
    const { status, body } = await rpc("tools/list", {}, 2);
    expect(status).toBe(200);
    expect(Array.isArray(body.result.tools)).toBe(true);

    const toolNames = body.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("operator_list");
    expect(toolNames).toContain("operator_spawn");
    expect(toolNames).toContain("tts_speak");
    expect(toolNames).toContain("drive_set_mode");
  });

  it("calls operator_list and gets empty result", async () => {
    const { body } = await rpc("tools/call", { name: "operator_list", arguments: {} }, 3);
    expect(body.result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "No active operators." }),
      ]),
    );
  });

  it("spawns an operator and verifies it in list", async () => {
    const spawn = await rpc("tools/call", {
      name: "operator_spawn",
      arguments: { name: "TestBot", task: "integration test" },
    }, 4);
    expect(spawn.body.result.content[0].text).toMatch(/Spawned operator: TestBot/);

    const list = await rpc("tools/call", { name: "operator_list", arguments: {} }, 5);
    expect(list.body.result.content[0].text).toMatch(/TestBot/);
  });

  it("rejects unsupported HTTP methods", async () => {
    const res = await rawRequest("PUT");
    expect(res.status).toBe(405);
  });
});
