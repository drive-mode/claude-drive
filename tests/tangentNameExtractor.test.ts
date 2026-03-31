import { jest } from "@jest/globals";

// Mock the @anthropic-ai/sdk module before importing the module under test
jest.unstable_mockModule("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: jest.fn<() => Promise<{ content: Array<{ type: string; text: string }> }>>().mockResolvedValue({
        content: [{ type: "text", text: '{"name": null, "task": "some fallback task"}' }],
      }),
    };
  },
}));

const { extractTangentNameAndTask } = await import("../src/tangentNameExtractor.js");

describe("extractTangentNameAndTask", () => {
  describe("regex extraction (Tier 0)", () => {
    it("extracts name and task from em-dash separator", async () => {
      const result = await extractTangentNameAndTask("Alpha \u2014 research auth");
      expect(result.name).toBe("Alpha");
      expect(result.task).toBe("research auth");
    });

    it("extracts name and task from 'call it X: task' pattern", async () => {
      const result = await extractTangentNameAndTask("call it Beta: fix the bug");
      expect(result.name).toBe("Beta");
      expect(result.task).toBe("fix the bug");
    });

    it("extracts name and task from hyphen-dash separator", async () => {
      const result = await extractTangentNameAndTask("Gamma - implement feature");
      expect(result.name).toBe("Gamma");
      expect(result.task).toBe("implement feature");
    });

    it("extracts name and task from colon separator", async () => {
      const result = await extractTangentNameAndTask("Delta: write tests");
      expect(result.name).toBe("Delta");
      expect(result.task).toBe("write tests");
    });

    it("handles multi-word names with em-dash", async () => {
      const result = await extractTangentNameAndTask("The Godly Knight \u2014 attack");
      expect(result.name).toBe("The Godly Knight");
      expect(result.task).toBe("attack");
    });

    it("handles 'call it' prefix with multi-word name", async () => {
      const result = await extractTangentNameAndTask("call it Code Wizard - refactor utils");
      expect(result.name).toBe("Code Wizard");
      expect(result.task).toBe("refactor utils");
    });
  });

  describe("model fallback (Tier 1)", () => {
    it("falls through to model extraction when no separator present", async () => {
      // No separator, so regex won't match; model extraction takes over
      const result = await extractTangentNameAndTask("just do something");
      expect(result).toBeDefined();
      expect(result.task).toBeDefined();
      expect(result.task.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty input by returning task from model", async () => {
      const result = await extractTangentNameAndTask("");
      expect(result).toBeDefined();
      expect(typeof result.task).toBe("string");
    });

    it("handles whitespace-only input", async () => {
      const result = await extractTangentNameAndTask("   ");
      expect(result).toBeDefined();
      expect(typeof result.task).toBe("string");
    });

    it("trims whitespace from name and task", async () => {
      const result = await extractTangentNameAndTask("  Alpha   \u2014   research auth  ");
      expect(result.name).toBe("Alpha");
      expect(result.task).toBe("research auth");
    });

    it("handles separator with no task text after it as fallback", async () => {
      // "Alpha — " has empty task after trim, so regex returns undefined -> model
      const result = await extractTangentNameAndTask("Alpha \u2014 ");
      expect(result).toBeDefined();
      expect(typeof result.task).toBe("string");
    });
  });
});
