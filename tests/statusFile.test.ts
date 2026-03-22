import * as fs from "fs";
import { writeStatusFile, deleteStatusFile, getStatusFilePath } from "../src/statusFile.js";
import type { StatusFileData } from "../src/statusFile.js";

const STATUS_PATH = getStatusFilePath();

function cleanup(): void {
  try { fs.unlinkSync(STATUS_PATH); } catch { /* ok */ }
  try { fs.unlinkSync(STATUS_PATH + ".tmp"); } catch { /* ok */ }
}

afterEach(cleanup);

const zeroStats = { costUsd: 0, durationMs: 0, apiDurationMs: 0, turns: 0, taskCount: 0 };

const sampleData: StatusFileData = {
  active: true,
  subMode: "agent",
  foregroundOperator: "Alpha",
  operators: [
    { name: "Alpha", status: "active", role: "implementer", task: "build auth", stats: { costUsd: 0.05, durationMs: 12000, apiDurationMs: 8000, turns: 5, taskCount: 1 } },
    { name: "Beta", status: "background", role: "reviewer", task: "review PR", stats: { costUsd: 0.02, durationMs: 6000, apiDurationMs: 4000, turns: 3, taskCount: 1 } },
  ],
  totals: { costUsd: 0.07, durationMs: 18000, apiDurationMs: 12000, turns: 8, taskCount: 2 },
  currentPlan: null,
  lastCompletedPlan: null,
  updatedAt: Date.now(),
};

describe("writeStatusFile()", () => {
  it("creates status.json with correct data", () => {
    writeStatusFile(sampleData);
    const raw = fs.readFileSync(STATUS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.active).toBe(true);
    expect(parsed.subMode).toBe("agent");
    expect(parsed.foregroundOperator).toBe("Alpha");
    expect(parsed.operators).toHaveLength(2);
    expect(parsed.operators[0].name).toBe("Alpha");
  });

  it("overwrites existing file", () => {
    writeStatusFile(sampleData);
    const updated = { ...sampleData, subMode: "plan", updatedAt: Date.now() };
    writeStatusFile(updated);
    const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
    expect(parsed.subMode).toBe("plan");
  });
});

describe("deleteStatusFile()", () => {
  it("removes the status file", () => {
    writeStatusFile(sampleData);
    expect(fs.existsSync(STATUS_PATH)).toBe(true);
    deleteStatusFile();
    expect(fs.existsSync(STATUS_PATH)).toBe(false);
  });

  it("does not throw when file is already gone", () => {
    expect(() => deleteStatusFile()).not.toThrow();
  });
});

describe("stats and plan data", () => {
  it("persists per-operator stats", () => {
    writeStatusFile(sampleData);
    const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
    expect(parsed.operators[0].stats.costUsd).toBe(0.05);
    expect(parsed.operators[0].stats.turns).toBe(5);
    expect(parsed.operators[1].stats.costUsd).toBe(0.02);
  });

  it("persists totals", () => {
    writeStatusFile(sampleData);
    const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
    expect(parsed.totals.costUsd).toBe(0.07);
    expect(parsed.totals.taskCount).toBe(2);
  });

  it("persists plan cost data", () => {
    const withPlan = {
      ...sampleData,
      currentPlan: { planIndex: 1, costUsd: 0.03, durationMs: 5000, turns: 4, taskCount: 1, active: true },
    };
    writeStatusFile(withPlan);
    const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
    expect(parsed.currentPlan.planIndex).toBe(1);
    expect(parsed.currentPlan.costUsd).toBe(0.03);
    expect(parsed.currentPlan.active).toBe(true);
  });
});

describe("getStatusFilePath()", () => {
  it("returns a path ending in status.json", () => {
    expect(getStatusFilePath()).toMatch(/status\.json$/);
  });

  it("contains .claude-drive directory", () => {
    expect(getStatusFilePath()).toContain(".claude-drive");
  });
});
