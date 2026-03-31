import { evaluateFocusGuard } from "../../src/governance/focusGuard.js";
import type { FocusGuardInput } from "../../src/governance/focusGuard.js";

describe("evaluateFocusGuard()", () => {
  it("detects scope drift when files do not match the task", () => {
    const input: FocusGuardInput = {
      operatorName: "Alpha",
      task: "fix authentication bug in login module",
      filesTouched: [
        "src/authentication/login.ts",
        "src/billing/invoice.ts",
        "src/dashboard/widgets.ts",
      ],
    };

    const result = evaluateFocusGuard(input);

    expect(result.inScope).toBe(false);
    expect(result.outOfScopeFiles.length).toBeGreaterThan(0);
    expect(result.outOfScopeFiles).toContain("src/billing/invoice.ts");
    expect(result.outOfScopeFiles).toContain("src/dashboard/widgets.ts");
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].category).toBe("focus");
  });

  it("reports no drift when files align with the task", () => {
    const input: FocusGuardInput = {
      operatorName: "Alpha",
      task: "fix authentication bug in login module",
      filesTouched: [
        "src/authentication/login.ts",
        "src/login/handler.ts",
      ],
    };

    const result = evaluateFocusGuard(input);

    expect(result.inScope).toBe(true);
    expect(result.outOfScopeFiles).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("always allows test files regardless of task keywords", () => {
    const input: FocusGuardInput = {
      operatorName: "Alpha",
      task: "fix authentication bug in login module",
      filesTouched: [
        "src/authentication/login.ts",
        "tests/billing.test.ts",
      ],
    };

    const result = evaluateFocusGuard(input);

    expect(result.inScope).toBe(true);
    expect(result.outOfScopeFiles).toEqual([]);
  });

  it("always allows config files like package.json and tsconfig", () => {
    const input: FocusGuardInput = {
      operatorName: "Alpha",
      task: "fix authentication bug in login module",
      filesTouched: [
        "src/authentication/login.ts",
        "package.json",
        "tsconfig.json",
      ],
    };

    const result = evaluateFocusGuard(input);

    expect(result.inScope).toBe(true);
    expect(result.outOfScopeFiles).toEqual([]);
  });

  it("returns inScope=true for empty task description", () => {
    const input: FocusGuardInput = {
      operatorName: "Alpha",
      task: "",
      filesTouched: [
        "src/billing/invoice.ts",
        "src/dashboard/widgets.ts",
      ],
    };

    const result = evaluateFocusGuard(input);

    expect(result.inScope).toBe(true);
    expect(result.outOfScopeFiles).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("returns inScope=true when no files changed", () => {
    const input: FocusGuardInput = {
      operatorName: "Alpha",
      task: "fix authentication bug in login module",
      filesTouched: [],
    };

    const result = evaluateFocusGuard(input);

    expect(result.inScope).toBe(true);
    expect(result.outOfScopeFiles).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("sets severity to high when many files are out of scope", () => {
    const input: FocusGuardInput = {
      operatorName: "Alpha",
      task: "fix authentication bug in login module",
      filesTouched: [
        "src/billing/a.ts",
        "src/billing/b.ts",
        "src/billing/c.ts",
        "src/billing/d.ts",
      ],
    };

    const result = evaluateFocusGuard(input);

    expect(result.inScope).toBe(false);
    expect(result.outOfScopeFiles.length).toBe(4);
    expect(result.findings.every((f) => f.severity === "high")).toBe(true);
  });

  it("returns inScope=true when task has only stop words", () => {
    const input: FocusGuardInput = {
      operatorName: "Alpha",
      task: "fix the code and add new files",
      filesTouched: [
        "src/random/stuff.ts",
      ],
    };

    const result = evaluateFocusGuard(input);

    // All words in the task are stop words, so no keywords extracted -> no flagging
    expect(result.inScope).toBe(true);
    expect(result.findings).toEqual([]);
  });
});
