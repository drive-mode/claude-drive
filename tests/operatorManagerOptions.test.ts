/**
 * tests/operatorManagerOptions.test.ts — verifies that buildQueryOptions
 * maps config + RunOperatorOptions into the SDK-facing query options.
 */
import { buildQueryOptions } from "../src/operatorManager.js";
import type { OperatorContext } from "../src/operatorRegistry.js";
import { saveConfig } from "../src/config.js";

function makeOp(overrides: Partial<OperatorContext> = {}): OperatorContext {
  return {
    id: "id",
    name: "Op",
    voice: undefined,
    task: "t",
    status: "active",
    createdAt: 0,
    memory: [],
    visibility: "shared",
    depth: 0,
    permissionPreset: "standard",
    executionMode: "foreground",
    stats: { totalCostUsd: 0, totalDurationMs: 0, totalApiDurationMs: 0, totalTurns: 0, taskCount: 0 },
    ...overrides,
  };
}

describe("buildQueryOptions", () => {
  test("includes allowedTools and mcpServers by default", () => {
    const options = buildQueryOptions(makeOp(), "do a thing");
    expect(Array.isArray(options.allowedTools)).toBe(true);
    expect((options.allowedTools as string[]).length).toBeGreaterThan(0);
    expect(options.mcpServers).toEqual(expect.objectContaining({ "claude-drive": expect.any(Object) }));
  });

  test("agentProgressSummaries is enabled by default", () => {
    saveConfig("operator.agentProgressSummaries", true);
    const options = buildQueryOptions(makeOp(), "t");
    expect(options.agentProgressSummaries).toBe(true);
  });

  test("agentProgressSummaries can be disabled via config", () => {
    saveConfig("operator.agentProgressSummaries", false);
    const options = buildQueryOptions(makeOp(), "t");
    expect(options.agentProgressSummaries).toBe(false);
    saveConfig("operator.agentProgressSummaries", true); // reset
  });

  test("taskBudget is wrapped as { total }", () => {
    const options = buildQueryOptions(makeOp(), "t", { taskBudget: 1234 });
    expect(options.taskBudget).toEqual({ total: 1234 });
  });

  test("effort from options wins over op.effort", () => {
    const options = buildQueryOptions(
      makeOp({ effort: "medium" }),
      "t",
      { effort: "high" },
    );
    expect(options.effort).toBe("high");
  });

  test("effort from op when not in options", () => {
    const options = buildQueryOptions(makeOp({ effort: "low" }), "t");
    expect(options.effort).toBe("low");
  });

  test("effort from config when not on op or options", () => {
    saveConfig("operator.defaultEffort", "max");
    try {
      const options = buildQueryOptions(makeOp(), "t");
      expect(options.effort).toBe("max");
    } finally {
      saveConfig("operator.defaultEffort", undefined);
    }
  });

  test("no taskBudget/effort keys when neither supplied", () => {
    saveConfig("operator.defaultEffort", undefined);
    saveConfig("operator.taskBudget", undefined);
    const options = buildQueryOptions(makeOp(), "t");
    expect(options).not.toHaveProperty("taskBudget");
    expect(options).not.toHaveProperty("effort");
  });
});
