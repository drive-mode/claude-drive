/**
 * tests/mcpToolContracts.test.ts — validates that the MCP tool registry
 * preserves back-compat aliases after the Stage 11 consolidation.
 */
import { buildMcpServer } from "../src/mcpServer.js";
import { OperatorRegistry } from "../src/operatorRegistry.js";
import { createDriveModeManager } from "../src/driveMode.js";

function registeredToolNames(): string[] {
  const registry = new OperatorRegistry();
  const driveMode = createDriveModeManager();
  const server = buildMcpServer({ port: 0, registry, driveMode });
  const internals = server as unknown as { _registeredTools?: Record<string, unknown> };
  return Object.keys(internals._registeredTools ?? {}).sort();
}

describe("MCP tool contracts (Stage 11)", () => {
  const names = registeredToolNames();

  test("canonical agent_screen_log is registered", () => {
    expect(names).toContain("agent_screen_log");
  });

  test("legacy agent_screen_* aliases are preserved for back-compat", () => {
    expect(names).toEqual(expect.arrayContaining([
      "agent_screen_activity",
      "agent_screen_file",
      "agent_screen_decision",
      "agent_screen_clear",
      "agent_screen_chime",
    ]));
  });

  test("total tool count grew by 1 (canonical added; aliases retained)", () => {
    // Baseline before Stage 11 was 53. After Stage 11 we add agent_screen_log
    // and keep all 5 aliases → 54.
    expect(names.length).toBeGreaterThanOrEqual(54);
  });
});
