import { BUILTIN_AGENTS, registerBuiltins } from "../src/builtinAgents.js";
import { getAgentDefinition, clearBuiltinAgents } from "../src/agentDefinitionLoader.js";

beforeEach(() => clearBuiltinAgents());

describe("builtinAgents", () => {
  test("ships explore, bash, reviewer", () => {
    const names = BUILTIN_AGENTS.map((d) => d.name).sort();
    expect(names).toEqual(["bash", "explore", "reviewer"]);
  });

  test("registerBuiltins is idempotent", () => {
    registerBuiltins();
    registerBuiltins();
    const def = getAgentDefinition("explore");
    expect(def).toBeDefined();
    expect(def?.scope).toBe("builtin");
  });

  test("explore is a readonly researcher with low effort", () => {
    registerBuiltins();
    const d = getAgentDefinition("explore");
    expect(d).toMatchObject({ role: "researcher", preset: "readonly", effort: "low", background: false });
  });

  test("bash runs in background with worktree isolation", () => {
    registerBuiltins();
    const d = getAgentDefinition("bash");
    expect(d).toMatchObject({ background: true, isolation: "worktree" });
  });
});
