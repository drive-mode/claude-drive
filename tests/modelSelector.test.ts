import {
  getModelForTier,
  tierForMode,
  getModelForMode,
  MODEL_TIERS,
} from "../src/modelSelector.js";
import type { ModelTier, RouteMode } from "../src/modelSelector.js";

describe("tierForMode()", () => {
  it("maps 'plan' to 'planning'", () => {
    expect(tierForMode("plan")).toBe("planning");
  });

  it("maps 'debug' to 'reasoning'", () => {
    expect(tierForMode("debug")).toBe("reasoning");
  });

  it("maps 'agent' to 'execution'", () => {
    expect(tierForMode("agent")).toBe("execution");
  });

  it("maps 'ask' to 'execution'", () => {
    expect(tierForMode("ask")).toBe("execution");
  });
});

describe("getModelForTier()", () => {
  it("returns haiku for routing tier", () => {
    expect(getModelForTier("routing")).toBe("claude-3-5-haiku-20241022");
  });

  it("returns sonnet for planning tier", () => {
    expect(getModelForTier("planning")).toBe("claude-sonnet-4-20250514");
  });

  it("returns sonnet for execution tier", () => {
    expect(getModelForTier("execution")).toBe("claude-sonnet-4-20250514");
  });

  it("returns opus for reasoning tier", () => {
    expect(getModelForTier("reasoning")).toBe("claude-opus-4-20250514");
  });

  it("returns the default from MODEL_TIERS for each tier", () => {
    const tiers: ModelTier[] = ["routing", "planning", "execution", "reasoning"];
    for (const tier of tiers) {
      expect(getModelForTier(tier)).toBe(MODEL_TIERS[tier]);
    }
  });
});

describe("getModelForMode()", () => {
  it("plan mode returns planning tier model", () => {
    expect(getModelForMode("plan")).toBe(getModelForTier("planning"));
  });

  it("debug mode returns reasoning tier model", () => {
    expect(getModelForMode("debug")).toBe(getModelForTier("reasoning"));
  });

  it("agent mode returns execution tier model", () => {
    expect(getModelForMode("agent")).toBe(getModelForTier("execution"));
  });

  it("ask mode returns execution tier model", () => {
    expect(getModelForMode("ask")).toBe(getModelForTier("execution"));
  });

  it("all modes return a non-empty string", () => {
    const modes: RouteMode[] = ["plan", "agent", "ask", "debug"];
    for (const mode of modes) {
      const model = getModelForMode(mode);
      expect(typeof model).toBe("string");
      expect(model.length).toBeGreaterThan(0);
    }
  });
});
