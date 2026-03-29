import { jest } from "@jest/globals";

const mockGetConfig = jest.fn();

jest.unstable_mockModule("../src/config.js", () => ({
  getConfig: mockGetConfig,
}));

jest.unstable_mockModule("../src/atomicWrite.js", () => ({
  atomicWriteJSON: jest.fn(),
}));

let reflectionGate: typeof import("../src/reflectionGate.js");

beforeAll(async () => {
  mockGetConfig.mockImplementation((key: string) => {
    if (key === "reflection.rulesFile") return "/tmp/claude-drive-test-reflection-rules.json";
    if (key === "reflection.enabled") return true;
    if (key === "reflection.reflectorModel") return "haiku";
    return undefined;
  });
  reflectionGate = await import("../src/reflectionGate.js");
});

beforeEach(() => {
  reflectionGate.resetRulesCache();
});

describe("ReflectionGate", () => {

  // ── Default Rules ───────────────────────────────────────────────────────

  describe("getDefaultRules", () => {
    test("returns built-in rules", () => {
      const rules = reflectionGate.getDefaultRules();
      expect(rules.length).toBe(5);
      expect(rules.map((r) => r.id)).toEqual([
        "follow-through",
        "completeness",
        "safety-check",
        "scope-guard",
        "test-reminder",
      ]);
    });

    test("default rules have correct hook events", () => {
      const rules = reflectionGate.getDefaultRules();
      const byEvent = new Map<string, string[]>();
      for (const r of rules) {
        const list = byEvent.get(r.hookEvent) ?? [];
        list.push(r.id);
        byEvent.set(r.hookEvent, list);
      }
      expect(byEvent.get("Stop")).toContain("follow-through");
      expect(byEvent.get("Stop")).toContain("completeness");
      expect(byEvent.get("PreToolUse")).toContain("safety-check");
      expect(byEvent.get("UserPromptSubmit")).toContain("scope-guard");
      expect(byEvent.get("PostToolUse")).toContain("test-reminder");
    });
  });

  // ── Rule Management ─────────────────────────────────────────────────────

  describe("addReflectionRule", () => {
    test("adds a custom rule with generated ID", () => {
      const rule = reflectionGate.addReflectionRule({
        question: "Did you check edge cases?",
        hookEvent: "Stop",
        tags: ["quality"],
        enabled: true,
        priority: 50,
      });

      expect(rule.id).toMatch(/^custom-/);
      expect(rule.question).toBe("Did you check edge cases?");
    });

    test("custom rules appear in getReflectionRules", () => {
      reflectionGate.addReflectionRule({
        question: "Custom check",
        hookEvent: "Stop",
        enabled: true,
        priority: 50,
      });

      const all = reflectionGate.getReflectionRules();
      expect(all.some((r) => r.question === "Custom check")).toBe(true);
    });
  });

  describe("removeReflectionRule", () => {
    test("removes existing custom rule", () => {
      const rule = reflectionGate.addReflectionRule({
        question: "To remove",
        hookEvent: "Stop",
        enabled: true,
        priority: 50,
      });
      expect(reflectionGate.removeReflectionRule(rule.id)).toBe(true);

      const all = reflectionGate.getReflectionRules();
      expect(all.some((r) => r.id === rule.id)).toBe(false);
    });

    test("returns false for non-existent rule", () => {
      expect(reflectionGate.removeReflectionRule("nonexistent")).toBe(false);
    });
  });

  describe("toggleReflectionRule", () => {
    test("toggles a custom rule", () => {
      const rule = reflectionGate.addReflectionRule({
        question: "Toggle me",
        hookEvent: "Stop",
        enabled: true,
        priority: 50,
      });

      reflectionGate.toggleReflectionRule(rule.id, false);
      const rules = reflectionGate.getReflectionRules();
      expect(rules.some((r) => r.id === rule.id)).toBe(false);

      reflectionGate.toggleReflectionRule(rule.id, true);
      const rulesAfter = reflectionGate.getReflectionRules();
      expect(rulesAfter.some((r) => r.id === rule.id)).toBe(true);
    });
  });

  // ── Role Filtering ──────────────────────────────────────────────────────

  describe("role filtering", () => {
    test("implementer gets scope-guard and test-reminder", () => {
      const hooks = reflectionGate.buildReflectionHooks("implementer");
      expect(hooks.UserPromptSubmit).toBeDefined();
      expect(hooks.PostToolUse).toBeDefined();
    });

    test("reviewer does not get implementer-only rules", () => {
      const hooks = reflectionGate.buildReflectionHooks("reviewer");
      expect(hooks.UserPromptSubmit).toBeUndefined();
      expect(hooks.PostToolUse).toBeUndefined();
    });

    test("all roles get follow-through (Stop hook)", () => {
      for (const role of ["implementer", "reviewer", "tester", "researcher", "planner"] as const) {
        const hooks = reflectionGate.buildReflectionHooks(role);
        expect(hooks.Stop).toBeDefined();
      }
    });

    test("no role still gets non-role-specific rules", () => {
      const hooks = reflectionGate.buildReflectionHooks(undefined);
      expect(hooks.Stop).toBeDefined();
      expect(hooks.PreToolUse).toBeDefined();
    });
  });

  // ── SDK Hook Structure ──────────────────────────────────────────────────

  describe("buildReflectionHooks", () => {
    test("returns valid SDK hook structure", () => {
      const hooks = reflectionGate.buildReflectionHooks("implementer");

      if (hooks.UserPromptSubmit) {
        for (const group of hooks.UserPromptSubmit) {
          expect(Array.isArray(group.hooks)).toBe(true);
          for (const cb of group.hooks) {
            expect(typeof cb).toBe("function");
          }
        }
      }

      if (hooks.PreToolUse) {
        for (const group of hooks.PreToolUse) {
          expect(typeof group.matcher).toBe("string");
          expect(Array.isArray(group.hooks)).toBe(true);
        }
      }

      if (hooks.PostToolUse) {
        for (const group of hooks.PostToolUse) {
          expect(typeof group.matcher).toBe("string");
          expect(Array.isArray(group.hooks)).toBe(true);
        }
      }

      if (hooks.Stop) {
        for (const group of hooks.Stop) {
          expect(Array.isArray(group.hooks)).toBe(true);
        }
      }
    });

    test("hook callbacks return systemMessage", async () => {
      const hooks = reflectionGate.buildReflectionHooks("implementer");
      const stopHook = hooks.Stop?.[0]?.hooks?.[0];
      expect(stopHook).toBeDefined();
      if (stopHook) {
        const result = await stopHook({});
        expect(result).toHaveProperty("systemMessage");
        expect(typeof result.systemMessage).toBe("string");
        expect((result.systemMessage as string)).toContain("[Reflection Gate:");
      }
    });

    test("PreToolUse hooks have correct matcher", () => {
      const hooks = reflectionGate.buildReflectionHooks("implementer");
      expect(hooks.PreToolUse).toBeDefined();
      if (hooks.PreToolUse) {
        const matchers = hooks.PreToolUse.map((g) => g.matcher);
        expect(matchers.some((m) => m.includes("Bash"))).toBe(true);
      }
    });

    test("returns empty when reflection is disabled", () => {
      mockGetConfig.mockImplementation((key: string) => {
        if (key === "reflection.enabled") return false;
        return undefined;
      });
      const hooks = reflectionGate.buildReflectionHooks("implementer");
      expect(Object.keys(hooks).length).toBe(0);

      // Restore
      mockGetConfig.mockImplementation((key: string) => {
        if (key === "reflection.enabled") return true;
        if (key === "reflection.reflectorModel") return "haiku";
        return undefined;
      });
    });
  });

  // ── Subagent Definitions ────────────────────────────────────────────────

  describe("buildReflectorAgent", () => {
    test("returns valid subagent definition", () => {
      const agent = reflectionGate.buildReflectorAgent();
      expect(agent.description).toBeTruthy();
      expect(agent.prompt).toBeTruthy();
      expect(agent.tools).toEqual(["Read", "Grep", "Glob"]);
      expect(agent.model).toBe("haiku");
    });

    test("prompt contains key review criteria", () => {
      const agent = reflectionGate.buildReflectorAgent();
      expect(agent.prompt).toContain("promises");
      expect(agent.prompt).toContain("commitments");
      expect(agent.prompt).toContain("PASS");
      expect(agent.prompt).toContain("FAIL");
    });

    test("does not include Agent tool", () => {
      const agent = reflectionGate.buildReflectorAgent();
      expect(agent.tools).not.toContain("Agent");
    });
  });

  describe("buildBestPracticesAgent", () => {
    test("returns valid subagent definition", () => {
      const agent = reflectionGate.buildBestPracticesAgent();
      expect(agent.description).toBeTruthy();
      expect(agent.prompt).toBeTruthy();
      expect(agent.tools).toContain("Read");
      expect(agent.tools).toContain("Grep");
      expect(agent.model).toBe("sonnet");
    });

    test("prompt covers Claude API best practices", () => {
      const agent = reflectionGate.buildBestPracticesAgent();
      expect(agent.prompt).toContain("Claude API");
      expect(agent.prompt).toContain("Agent SDK");
      expect(agent.prompt).toContain("ESM imports");
      expect(agent.prompt).toContain("Atomic writes");
    });

    test("does not include Agent tool", () => {
      const agent = reflectionGate.buildBestPracticesAgent();
      expect(agent.tools).not.toContain("Agent");
    });
  });
});
