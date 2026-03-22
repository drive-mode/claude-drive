import * as fs from "fs";
import { generateStatusLineScript, getScriptPath } from "../src/statusLine.js";

describe("generateStatusLineScript()", () => {
  it("returns a bash script starting with shebang", () => {
    const script = generateStatusLineScript();
    expect(script).toMatch(/^#!\/usr\/bin\/env bash/);
  });

  it("includes node guard", () => {
    const script = generateStatusLineScript();
    expect(script).toContain("command -v node");
  });

  it("includes status file path reference", () => {
    const script = generateStatusLineScript();
    expect(script).toContain(".claude-drive");
    expect(script).toContain("status.json");
  });

  it("includes context window parsing", () => {
    const script = generateStatusLineScript();
    expect(script).toContain("used_percentage");
  });

  it("includes cost parsing", () => {
    const script = generateStatusLineScript();
    expect(script).toContain("total_cost_usd");
  });

  it("includes drive state parsing", () => {
    const script = generateStatusLineScript();
    expect(script).toContain("foregroundOperator");
    expect(script).toContain("subMode");
  });

  it("includes per-operator stats rendering", () => {
    const script = generateStatusLineScript();
    expect(script).toContain("op.stats");
    expect(script).toContain("fmtCost");
  });

  it("includes total cost display", () => {
    const script = generateStatusLineScript();
    expect(script).toContain("totals");
    expect(script).toContain("Total:");
  });

  it("includes plan cost display", () => {
    const script = generateStatusLineScript();
    expect(script).toContain("currentPlan");
    expect(script).toContain("lastCompletedPlan");
    expect(script).toContain("Plan #");
  });

  it("includes staleness check", () => {
    const script = generateStatusLineScript();
    expect(script).toContain("60000");
    expect(script).toContain("stale");
  });

  it("includes offline fallback", () => {
    const script = generateStatusLineScript();
    expect(script).toContain("offline");
  });
});

describe("getScriptPath()", () => {
  it("returns a path ending in statusline.sh", () => {
    expect(getScriptPath()).toMatch(/statusline\.sh$/);
  });

  it("is inside .claude-drive directory", () => {
    expect(getScriptPath()).toContain(".claude-drive");
  });
});
