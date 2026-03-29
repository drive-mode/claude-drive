import { jest } from "@jest/globals";

const mockGetConfig = jest.fn();

jest.unstable_mockModule("../src/config.js", () => ({
  getConfig: mockGetConfig,
}));

jest.unstable_mockModule("../src/atomicWrite.js", () => ({
  atomicWriteJSON: jest.fn(),
}));

let promptOptimizer: typeof import("../src/promptOptimizer.js");

beforeAll(async () => {
  mockGetConfig.mockImplementation((key: string) => {
    if (key === "optimizer.mutationModel") return "claude-haiku-4-5-20251001";
    if (key === "optimizer.maxIterations") return 20;
    if (key === "optimizer.improvementThreshold") return 0.02;
    if (key === "optimizer.checkpointEvery") return 5;
    if (key === "evaluation.passThreshold") return 0.7;
    return undefined;
  });
  promptOptimizer = await import("../src/promptOptimizer.js");
});

const SAMPLE_SCENARIOS = [
  {
    id: "s1",
    name: "README creation",
    description: "Create a README",
    prompt: "Add a README",
    expectedBehaviors: ["README", "created"],
    forbiddenBehaviors: ["TODO", "later"],
    tags: ["basic"],
  },
  {
    id: "s2",
    name: "Test coverage",
    description: "Ensure tests exist",
    prompt: "Add tests",
    expectedBehaviors: ["test", "coverage", "assert"],
    forbiddenBehaviors: ["skip", "ignore"],
    tags: ["testing"],
  },
];

describe("PromptOptimizer", () => {

  // ── Mutation Operators ──────────────────────────────────────────────────

  describe("MUTATION_PROMPTS", () => {
    test("all 6 mutation operators have prompts", () => {
      expect(Object.keys(promptOptimizer.MUTATION_PROMPTS).length).toBe(6);
      for (const op of promptOptimizer.ALL_MUTATION_OPERATORS) {
        expect(promptOptimizer.MUTATION_PROMPTS[op]).toBeTruthy();
        expect(typeof promptOptimizer.MUTATION_PROMPTS[op]).toBe("string");
      }
    });
  });

  describe("applyMutation", () => {
    test("dry-run appends mutation marker", async () => {
      const result = await promptOptimizer.applyMutation("Original prompt", "add-constraint", { dryRun: true });
      expect(result).toContain("Original prompt");
      expect(result).toContain("[MUTATED by add-constraint]");
    });

    test("each operator produces different marker in dry-run", async () => {
      const results = new Set<string>();
      for (const op of promptOptimizer.ALL_MUTATION_OPERATORS) {
        const result = await promptOptimizer.applyMutation("test", op, { dryRun: true });
        results.add(result);
      }
      expect(results.size).toBe(6);
    });
  });

  // ── Quick Evaluation ────────────────────────────────────────────────────

  describe("quickEvaluate", () => {
    test("scores prompt against scenarios", () => {
      const prompt = "I created a README with test coverage and assert statements";
      const result = promptOptimizer.quickEvaluate(prompt, SAMPLE_SCENARIOS as any);

      expect(result.score).toBeGreaterThan(0);
      expect(result.passRate).toBeGreaterThanOrEqual(0);
      expect(result.results.length).toBe(2);
    });

    test("perfect prompt scores high", () => {
      const prompt = "README created with test coverage and assert checks. No skips.";
      const result = promptOptimizer.quickEvaluate(prompt, SAMPLE_SCENARIOS as any);
      expect(result.score).toBeGreaterThan(0.7);
    });

    test("bad prompt scores low", () => {
      const prompt = "I'll do this later. TODO: skip for now, ignore tests.";
      const result = promptOptimizer.quickEvaluate(prompt, SAMPLE_SCENARIOS as any);
      expect(result.score).toBeLessThan(0.5);
    });

    test("handles empty scenarios", () => {
      const result = promptOptimizer.quickEvaluate("any prompt", []);
      expect(result.score).toBe(0);
      expect(result.passRate).toBe(0);
    });
  });

  // ── Optimization Loop ─────────────────────────────────────────────────

  describe("startOptimization", () => {
    test("runs optimization in dry-run mode", async () => {
      const run = await promptOptimizer.startOptimization({
        maxIterations: 3,
        mutationOperators: ["add-constraint", "tighten-language", "remove-bloat"],
        baselinePrompt: "README created with test coverage and assert checks",
        evalScenarios: SAMPLE_SCENARIOS as any,
        improvementThreshold: 0.02,
        checkpointEvery: 10,
        optimizeReflectionRules: false,
        dryRun: true,
      });
      expect(run.id).toMatch(/^opt-/);
      expect(run.status).toBe("running");

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = promptOptimizer.getOptimizationStatus(run.id);
      expect(status).toBeDefined();
      expect(status!.history.length).toBe(3);
      expect(status!.status).toBe("completed");
    });

    test("history tracks keep/revert decisions", async () => {
      const run = await promptOptimizer.startOptimization({
        maxIterations: 3,
        mutationOperators: promptOptimizer.ALL_MUTATION_OPERATORS,
        baselinePrompt: "Simple prompt",
        evalScenarios: SAMPLE_SCENARIOS as any,
        improvementThreshold: 0.02,
        checkpointEvery: 0,
        optimizeReflectionRules: false,
        dryRun: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = promptOptimizer.getOptimizationStatus(run.id)!;
      for (const step of status.history) {
        expect(step.iteration).toBeGreaterThan(0);
        expect(typeof step.kept).toBe("boolean");
        expect(step.reason).toBeTruthy();
        expect(step.durationMs).toBeGreaterThanOrEqual(0);
        expect(promptOptimizer.ALL_MUTATION_OPERATORS).toContain(step.mutationOperator);
      }
    });

    test("round-robin mutation operator selection", async () => {
      const operators = ["add-constraint", "restructure", "remove-bloat"] as const;
      const run = await promptOptimizer.startOptimization({
        maxIterations: 6,
        mutationOperators: [...operators],
        baselinePrompt: "test prompt",
        evalScenarios: SAMPLE_SCENARIOS as any,
        improvementThreshold: 0.02,
        checkpointEvery: 0,
        optimizeReflectionRules: false,
        dryRun: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = promptOptimizer.getOptimizationStatus(run.id)!;
      expect(status.history.length).toBe(6);
      expect(status.history[0].mutationOperator).toBe("add-constraint");
      expect(status.history[1].mutationOperator).toBe("restructure");
      expect(status.history[2].mutationOperator).toBe("remove-bloat");
      expect(status.history[3].mutationOperator).toBe("add-constraint");
    });
  });

  describe("stopOptimization", () => {
    test("stops a running optimization", async () => {
      const run = await promptOptimizer.startOptimization({
        maxIterations: 1000,
        mutationOperators: promptOptimizer.ALL_MUTATION_OPERATORS,
        baselinePrompt: "test",
        evalScenarios: SAMPLE_SCENARIOS as any,
        improvementThreshold: 0.02,
        checkpointEvery: 0,
        optimizeReflectionRules: false,
        dryRun: true,
      });

      const stopped = promptOptimizer.stopOptimization(run.id);
      expect(stopped).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const status = promptOptimizer.getOptimizationStatus(run.id)!;
      expect(status.status).toBe("stopped");
      expect(status.history.length).toBeLessThan(1000);
    });

    test("returns false for non-existent run", () => {
      expect(promptOptimizer.stopOptimization("nonexistent")).toBe(false);
    });
  });

  // ── Summary ─────────────────────────────────────────────────────────────

  describe("getOptimizationSummary", () => {
    test("generates readable summary", () => {
      const run = {
        id: "opt-test",
        status: "completed" as const,
        config: {
          maxIterations: 10,
          mutationOperators: promptOptimizer.ALL_MUTATION_OPERATORS,
          baselinePrompt: "test",
          evalScenarios: [],
          improvementThreshold: 0.02,
          checkpointEvery: 5,
          optimizeReflectionRules: false,
        },
        currentIteration: 10,
        bestPrompt: "improved test",
        bestScore: 0.85,
        baselineScore: 0.60,
        history: [
          {
            iteration: 1, mutationOperator: "add-constraint" as const,
            mutatedPrompt: "p", score: 0.7, baselineScore: 0.6,
            kept: true, reason: "Improved", durationMs: 100,
          },
          {
            iteration: 2, mutationOperator: "restructure" as const,
            mutatedPrompt: "p", score: 0.65, baselineScore: 0.7,
            kept: false, reason: "No improvement", durationMs: 100,
          },
        ],
        startedAt: 1000,
        completedAt: 5000,
      };

      const summary = promptOptimizer.getOptimizationSummary(run);
      expect(summary).toContain("opt-test");
      expect(summary).toContain("completed");
      expect(summary).toContain("60.0%");
      expect(summary).toContain("85.0%");
      expect(summary).toContain("+25.0%");
      expect(summary).toContain("1/2");
      expect(summary).toContain("add-constraint");
    });
  });
});
