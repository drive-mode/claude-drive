import * as fs from "fs";
import { writeStatusFile, deleteStatusFile, getStatusFilePath } from "../src/statusFile.js";
import type { StatusFileData } from "../src/statusFile.js";

const STATUS_PATH = getStatusFilePath();

function cleanup(): void {
  try { fs.unlinkSync(STATUS_PATH); } catch { /* ok */ }
  try { fs.unlinkSync(STATUS_PATH + ".tmp"); } catch { /* ok */ }
}

afterEach(cleanup);

const sampleData: StatusFileData = {
  active: true,
  subMode: "agent",
  foregroundOperator: "Alpha",
  operators: [
    { name: "Alpha", status: "active", role: "implementer", task: "build auth" },
    { name: "Beta", status: "background", role: "reviewer", task: "review PR" },
  ],
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

describe("getStatusFilePath()", () => {
  it("returns a path ending in status.json", () => {
    expect(getStatusFilePath()).toMatch(/status\.json$/);
  });

  it("contains .claude-drive directory", () => {
    expect(getStatusFilePath()).toContain(".claude-drive");
  });
});
