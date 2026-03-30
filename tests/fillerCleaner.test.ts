import { cleanFillerWords, looksLikeDictation } from "../src/fillerCleaner.js";

describe("cleanFillerWords()", () => {
  it("returns empty input unchanged with wasModified false", () => {
    const result = cleanFillerWords("");
    expect(result.cleaned).toBe("");
    expect(result.wasModified).toBe(false);
  });

  it("returns whitespace-only input unchanged with wasModified false", () => {
    const result = cleanFillerWords("   ");
    expect(result.cleaned).toBe("   ");
    expect(result.wasModified).toBe(false);
  });

  it("removes 'umm' filler word", () => {
    const result = cleanFillerWords("umm fix the bug");
    expect(result.wasModified).toBe(true);
    expect(result.cleaned.toLowerCase()).not.toContain("umm");
    expect(result.cleaned.toLowerCase()).toContain("fix the bug");
  });

  it("removes multiple filler words", () => {
    const result = cleanFillerWords("uhh uh like fix it");
    expect(result.wasModified).toBe(true);
    expect(result.cleaned.toLowerCase()).not.toMatch(/\buhh\b/);
    expect(result.cleaned.toLowerCase()).not.toMatch(/\buh\b/);
    expect(result.cleaned.toLowerCase()).not.toMatch(/\blike\b/);
    expect(result.cleaned.toLowerCase()).toContain("fix it");
  });

  it("passes through clean input with wasModified false", () => {
    const result = cleanFillerWords("fix the authentication bug");
    expect(result.cleaned).toBe("fix the authentication bug");
    expect(result.wasModified).toBe(false);
  });

  it("preserves sentence casing", () => {
    const result = cleanFillerWords("Umm fix the bug");
    expect(result.cleaned[0]).toBe(result.cleaned[0].toUpperCase());
  });

  it("collapses duplicate words", () => {
    const result = cleanFillerWords("can you can you do this");
    expect(result.cleaned.toLowerCase()).toBe("can you do this");
  });

  it("original field preserves the raw input", () => {
    const raw = "umm fix the bug";
    const result = cleanFillerWords(raw);
    expect(result.original).toBe(raw);
  });
});

describe("looksLikeDictation()", () => {
  it("returns true for text with many fillers", () => {
    expect(looksLikeDictation("umm uhh like fix the uh thing")).toBe(true);
  });

  it("returns false for clean text", () => {
    expect(looksLikeDictation("fix the authentication bug")).toBe(false);
  });

  it("returns true for trailing uncertainty pattern", () => {
    expect(looksLikeDictation("maybe fix the bug right?")).toBe(true);
  });
});
