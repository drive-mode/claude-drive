#!/usr/bin/env node
/**
 * mcp-probe.js — Zero-dep MCP HTTP probe for claude-drive dev work.
 *
 * Reads the running server's port from ~/.claude-drive/port and drives
 * the MCP protocol (initialize → tools/list or tools/call) without
 * requiring Claude Code.
 *
 * Usage:
 *   node scripts/mcp-probe.js list
 *   node scripts/mcp-probe.js call <tool_name> [json_args]
 *   node scripts/mcp-probe.js state
 *
 * Examples:
 *   node scripts/mcp-probe.js list
 *   node scripts/mcp-probe.js call operator_spawn '{"name":"alice"}'
 *   node scripts/mcp-probe.js call drive_get_state '{}'
 *   node scripts/mcp-probe.js state
 */
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const PORT_FILE = path.join(os.homedir(), ".claude-drive", "port");

function readPort() {
  try {
    const p = parseInt(fs.readFileSync(PORT_FILE, "utf-8").trim(), 10);
    if (Number.isFinite(p)) return p;
  } catch {
    // fall through
  }
  console.error(`[mcp-probe] No port file at ${PORT_FILE}. Is the server running?`);
  console.error(`[mcp-probe] Try: npm run dev   (or: node out/cli.js start)`);
  process.exit(1);
}

function rpc(port, sessionId, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(body),
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          const sid = res.headers["mcp-session-id"] || sessionId;
          // Body may be JSON or SSE (event-stream). Strip SSE framing if present.
          const text = raw.startsWith("event:") || raw.includes("\ndata:")
            ? raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("")
            : raw;
          try {
            resolve({ sid, body: text ? JSON.parse(text) : null, status: res.statusCode });
          } catch (e) {
            resolve({ sid, body: { raw: text }, status: res.statusCode, parseError: String(e) });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function handshake(port) {
  const init = await rpc(port, undefined, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "mcp-probe", version: "0.1" },
    },
  });
  if (init.status !== 200) {
    console.error(`[mcp-probe] initialize failed: HTTP ${init.status}`);
    console.error(init.body);
    process.exit(1);
  }
  await rpc(port, init.sid, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  return init.sid;
}

async function cmdList() {
  const port = readPort();
  const sid = await handshake(port);
  const res = await rpc(port, sid, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = res.body?.result?.tools ?? [];
  console.log(`[mcp-probe] ${tools.length} tools registered:\n`);
  const maxName = Math.max(...tools.map((t) => t.name.length), 10);
  for (const t of tools) {
    console.log(`  ${t.name.padEnd(maxName)}  ${t.description ?? ""}`);
  }
}

async function cmdCall(tool, argsJson) {
  const port = readPort();
  let args = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.error(`[mcp-probe] args is not valid JSON: ${e}`);
      process.exit(1);
    }
  }
  const sid = await handshake(port);
  const res = await rpc(port, sid, {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: { name: tool, arguments: args },
  });
  if (res.body?.error) {
    console.error(`[mcp-probe] ERROR: ${JSON.stringify(res.body.error, null, 2)}`);
    process.exit(1);
  }
  const result = res.body?.result;
  const content = result?.content ?? [];
  for (const c of content) {
    if (c.type === "text") console.log(c.text);
    else console.log(JSON.stringify(c, null, 2));
  }
  if (result?.isError) {
    console.error(`[mcp-probe] tool reported isError`);
    process.exit(2);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "list":
      return cmdList();
    case "call":
      if (!rest[0]) {
        console.error("Usage: mcp-probe call <tool_name> [json_args]");
        process.exit(1);
      }
      return cmdCall(rest[0], rest[1]);
    case "state":
      return cmdCall("drive_get_state", "{}");
    default:
      console.error("Usage:");
      console.error("  mcp-probe list                              # list all MCP tools");
      console.error("  mcp-probe call <tool> [json]                # call a specific tool");
      console.error("  mcp-probe state                             # shortcut for drive_get_state");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`[mcp-probe] fatal: ${e}`);
  process.exit(1);
});
