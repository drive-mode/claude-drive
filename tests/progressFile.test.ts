import fs from "fs";
import os from "os";
import path from "path";
import {
  writeProgressEvent,
  readProgressSnapshot,
  progressDir,
  clearProgress,
} from "../src/progressFile.js";

function tmpBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cd-progress-"));
}

describe("progressFile", () => {
  test("writeProgressEvent appends JSONL and writes last.json atomically", () => {
    const base = tmpBaseDir();
    writeProgressEvent("op1", { type: "task_started", description: "boot" }, base);
    writeProgressEvent("op1", { type: "task_progress", summary: "half" }, base);

    const dir = progressDir("op1", base);
    const lines = fs.readFileSync(path.join(dir, "events.jsonl"), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const last = JSON.parse(fs.readFileSync(path.join(dir, "last.json"), "utf-8"));
    expect(last.type).toBe("task_progress");
    expect(last.operatorId).toBe("op1");
    expect(typeof last.timestamp).toBe("number");
  });

  test("readProgressSnapshot returns last + events", () => {
    const base = tmpBaseDir();
    writeProgressEvent("op2", { type: "task_started", description: "x" }, base);
    writeProgressEvent("op2", { type: "result", stats: { totalCostUsd: 0.01, durationMs: 5, numTurns: 1 } }, base);
    const snap = readProgressSnapshot("op2", base);
    expect(snap.events).toHaveLength(2);
    expect(snap.last?.type).toBe("result");
  });

  test("readProgressSnapshot returns empty for missing operator", () => {
    const base = tmpBaseDir();
    const snap = readProgressSnapshot("never-existed", base);
    expect(snap.last).toBeUndefined();
    expect(snap.events).toEqual([]);
  });

  test("clearProgress removes the directory", () => {
    const base = tmpBaseDir();
    writeProgressEvent("op3", { type: "task_started", description: "x" }, base);
    expect(fs.existsSync(progressDir("op3", base))).toBe(true);
    clearProgress("op3", base);
    expect(fs.existsSync(progressDir("op3", base))).toBe(false);
  });

  test("stamps operatorId even when not provided", () => {
    const base = tmpBaseDir();
    const ev = writeProgressEvent("op4", { type: "status" }, base);
    expect(ev.operatorId).toBe("op4");
  });
});
