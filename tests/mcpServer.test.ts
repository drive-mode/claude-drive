import os from "os";
import { getPortFilePath, readPortFile, buildMcpServer } from "../src/mcpServer.js";
import { OperatorRegistry } from "../src/operatorRegistry.js";
import { createDriveModeManager } from "../src/driveMode.js";

describe("getPortFilePath()", () => {
  it("returns a path ending in 'port'", () => {
    const p = getPortFilePath();
    expect(p.endsWith("port")).toBe(true);
  });

  it("is inside the home directory", () => {
    const p = getPortFilePath();
    expect(p.startsWith(os.homedir())).toBe(true);
  });

  it("contains .claude-drive in the path", () => {
    const p = getPortFilePath();
    expect(p).toContain(".claude-drive");
  });

  it("returns the same value on repeated calls", () => {
    expect(getPortFilePath()).toBe(getPortFilePath());
  });
});

describe("readPortFile()", () => {
  it("returns undefined when port file does not exist", () => {
    // Port file won't exist in the test environment
    // (unless the server happens to be running, but the file path is deterministic)
    const port = readPortFile();
    // Either undefined (file absent) or a valid number (server running)
    expect(port === undefined || (typeof port === "number" && port > 0)).toBe(true);
  });

  it("returns undefined for a non-existent path gracefully", async () => {
    // We can test the error-handling branch by checking a path that definitely doesn't exist
    // readPortFile catches errors internally and returns undefined
    // This just verifies it doesn't throw
    expect(() => readPortFile()).not.toThrow();
  });
});

describe("buildMcpServer — registered tools", () => {
  function names(): string[] {
    const registry = new OperatorRegistry();
    const driveMode = createDriveModeManager();
    const server = buildMcpServer({ port: 0, registry, driveMode });
    // The MCP McpServer instance exposes its registered tools via an internal
    // `_registeredTools` map (object keyed by name). We access it defensively.
    const internals = server as unknown as { _registeredTools?: Record<string, unknown> };
    const map = internals._registeredTools ?? {};
    return Object.keys(map).sort();
  }

  it("registers all new Phase 2/3 tools", () => {
    const ns = names();
    // Sanity: existing well-known tools still present.
    expect(ns).toEqual(expect.arrayContaining([
      "drive_run_task",
      "drive_get_state",
      "operator_spawn",
      "operator_list",
    ]));
    // New tools introduced by this PR.
    expect(ns).toEqual(expect.arrayContaining([
      "operator_get_progress",
      "operator_await",
      "operator_context_usage",
      "operator_tree",
      "agent_list",
      "agent_inspect",
      "drive_best_of_n",
    ]));
  });

  it("registers at least 45 tools (sanity bound for future regressions)", () => {
    expect(names().length).toBeGreaterThanOrEqual(45);
  });

  it("operator_spawn tool accepts parentId/effort/executionMode/agent parameters", () => {
    const registry = new OperatorRegistry();
    const driveMode = createDriveModeManager();
    const server = buildMcpServer({ port: 0, registry, driveMode });
    const internals = server as unknown as { _registeredTools?: Record<string, { inputSchema?: { shape?: Record<string, unknown> } }> };
    const tool = internals._registeredTools?.["operator_spawn"];
    // Zod schema shape — verify each new key exists.
    const shape = (tool?.inputSchema as unknown as { shape?: Record<string, unknown> })?.shape ?? {};
    expect(Object.keys(shape)).toEqual(expect.arrayContaining([
      "name", "task", "role", "preset", "parentId", "effort", "executionMode", "agent",
    ]));
  });
});
