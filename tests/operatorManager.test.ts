/**
 * tests/operatorManager.test.ts — unit tests for pure functions in operatorManager.ts
 */
import { toolsForPreset, buildOperatorSystemPrompt, buildSubagentDefs } from "../src/operatorManager.js";
import type { OperatorContext } from "../src/operatorRegistry.js";

function makeOp(overrides: Partial<OperatorContext> = {}): OperatorContext {
  return {
    id: "test-id",
    name: "Alpha",
    voice: undefined,
    task: "do something",
    status: "active",
    createdAt: 0,
    memory: [],
    visibility: "shared",
    depth: 0,
    permissionPreset: "standard",
    ...overrides,
  };
}

describe("toolsForPreset", () => {
  test("readonly returns only read-only tools", () => {
    const tools = toolsForPreset("readonly");
    expect(tools).toContain("Read");
    expect(tools).toContain("Glob");
    expect(tools).toContain("Grep");
    expect(tools).toContain("WebSearch");
    expect(tools).toContain("WebFetch");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("Bash");
  });

  test("standard returns read-only + write tools", () => {
    const tools = toolsForPreset("standard");
    expect(tools).toContain("Read");
    expect(tools).toContain("Edit");
    expect(tools).toContain("Write");
    expect(tools).toContain("Bash");
    expect(tools).toContain("Agent");
  });

  test("full returns all tools", () => {
    const tools = toolsForPreset("full");
    expect(tools).toContain("Read");
    expect(tools).toContain("Edit");
    expect(tools).toContain("Write");
    expect(tools).toContain("Bash");
  });

  test("unknown preset defaults to standard", () => {
    const standard = toolsForPreset("standard");
    const unknown = toolsForPreset("unknown" as never);
    expect(unknown).toEqual(standard);
  });
});

describe("buildOperatorSystemPrompt", () => {
  test("includes operator name", () => {
    const prompt = buildOperatorSystemPrompt(makeOp({ name: "TestBot" }));
    expect(prompt).toContain('"TestBot"');
  });

  test("includes role when set", () => {
    const prompt = buildOperatorSystemPrompt(makeOp({ role: "reviewer" }));
    expect(prompt).toContain("reviewer");
  });

  test("includes systemHint when set", () => {
    const prompt = buildOperatorSystemPrompt(makeOp({ systemHint: "Be concise." }));
    expect(prompt).toContain("Be concise.");
  });

  test("omits role/hint sections when not set", () => {
    const prompt = buildOperatorSystemPrompt(makeOp());
    expect(prompt).not.toContain("Your role:");
  });

  test("includes last 10 memory entries", () => {
    const memory = Array.from({ length: 15 }, (_, i) => `mem${i}`);
    const prompt = buildOperatorSystemPrompt(makeOp({ memory }));
    // Should include mem5..mem14 (last 10), not mem0..mem4
    expect(prompt).toContain("mem14");
    expect(prompt).toContain("mem5");
    expect(prompt).not.toContain("mem4");
  });

  test("readonly preset adds restriction notice", () => {
    const prompt = buildOperatorSystemPrompt(makeOp({ permissionPreset: "readonly" }));
    expect(prompt).toContain("READ-ONLY");
  });

  test("non-readonly preset has no restriction notice", () => {
    const prompt = buildOperatorSystemPrompt(makeOp({ permissionPreset: "standard" }));
    expect(prompt).not.toContain("READ-ONLY");
  });

  test("includes MCP tool instructions", () => {
    const prompt = buildOperatorSystemPrompt(makeOp());
    expect(prompt).toContain("agent_screen_activity");
    expect(prompt).toContain("agent_screen_file");
    expect(prompt).toContain("agent_screen_decision");
    expect(prompt).toContain("tts_speak");
  });
});

describe("buildSubagentDefs", () => {
  test("returns empty object for empty array", () => {
    expect(buildSubagentDefs([])).toEqual({});
  });

  test("keys are operator names", () => {
    const ops = [makeOp({ name: "Alpha" }), makeOp({ id: "b", name: "Beta" })];
    const defs = buildSubagentDefs(ops);
    expect(Object.keys(defs)).toEqual(["Alpha", "Beta"]);
  });

  test("each def has description, prompt, and tools", () => {
    const op = makeOp({ name: "Gamma", role: "tester", task: "run tests" });
    const defs = buildSubagentDefs([op]);
    const def = defs["Gamma"];
    expect(def.description).toBeDefined();
    expect(def.prompt).toBeDefined();
    expect(Array.isArray(def.tools)).toBe(true);
  });

  test("description includes role and task", () => {
    const op = makeOp({ name: "Delta", role: "implementer", task: "add feature" });
    const defs = buildSubagentDefs([op]);
    expect(defs["Delta"].description).toContain("implementer");
    expect(defs["Delta"].description).toContain("add feature");
  });

  test("description fallback when no role", () => {
    const op = makeOp({ name: "Epsilon", task: "do work" });
    const defs = buildSubagentDefs([op]);
    expect(defs["Epsilon"].description).toContain("do work");
  });

  test("tools match permission preset", () => {
    const op = makeOp({ name: "Zeta", permissionPreset: "readonly" });
    const defs = buildSubagentDefs([op]);
    expect(defs["Zeta"].tools).not.toContain("Edit");
  });
});
