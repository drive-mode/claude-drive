import {
  expandGlossary,
  invalidateGlossaryCache,
} from "../src/glossaryExpander.js";
import type { GlossaryEntry } from "../src/glossaryExpander.js";

describe("expandGlossary()", () => {
  beforeEach(() => {
    invalidateGlossaryCache();
  });

  it("passes through text without triggers unchanged", () => {
    const result = expandGlossary("fix the authentication bug");
    expect(result.expanded).toBe("fix the authentication bug");
    expect(result.wasExpanded).toBe(false);
    expect(result.matchedTriggers).toHaveLength(0);
  });

  it("expands 'tangent' trigger", () => {
    const result = expandGlossary("tangent research auth");
    expect(result.wasExpanded).toBe(true);
    expect(result.expanded).toContain("spawn a parallel agent for");
    expect(result.expanded).toContain("research auth");
    expect(result.matchedTriggers).toContain("tangent");
  });

  it("strips 'hey drive' activation phrase", () => {
    const result = expandGlossary("hey drive fix the bug");
    expect(result.wasExpanded).toBe(true);
    expect(result.expanded).toBe("fix the bug");
    expect(result.matchedTriggers).toContain("hey drive");
  });

  it("expands 'go ahead' to 'proceed and implement'", () => {
    const result = expandGlossary("go ahead and do it");
    expect(result.wasExpanded).toBe(true);
    expect(result.expanded).toContain("proceed and implement");
    expect(result.matchedTriggers).toContain("go ahead");
  });

  it("preserves original text in result", () => {
    const original = "hey drive fix the bug";
    const result = expandGlossary(original);
    expect(result.original).toBe(original);
  });

  it("uses custom glossary when provided", () => {
    const custom: GlossaryEntry[] = [
      { trigger: "yolo", expansion: "you only live once" },
    ];
    const result = expandGlossary("yolo deploy to prod", custom);
    expect(result.wasExpanded).toBe(true);
    expect(result.expanded).toContain("you only live once");
    expect(result.matchedTriggers).toContain("yolo");
  });

  it("matchedTriggers lists all matched triggers", () => {
    const result = expandGlossary("hey drive go ahead and fix it");
    expect(result.matchedTriggers).toContain("hey drive");
    expect(result.matchedTriggers).toContain("go ahead");
    expect(result.matchedTriggers.length).toBeGreaterThanOrEqual(2);
  });
});

describe("invalidateGlossaryCache()", () => {
  it("does not throw when called", () => {
    expect(() => invalidateGlossaryCache()).not.toThrow();
  });

  it("allows glossary to be reloaded after invalidation", () => {
    // First call loads cache
    expandGlossary("tangent test");
    // Invalidate
    invalidateGlossaryCache();
    // Second call should reload and still work
    const result = expandGlossary("tangent test again");
    expect(result.wasExpanded).toBe(true);
  });
});
