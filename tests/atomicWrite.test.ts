import fs from "fs";
import path from "path";
import os from "os";
import { atomicWriteJSON } from "../src/atomicWrite.js";

describe("atomicWriteJSON", () => {
  const testDir = path.join(os.tmpdir(), `claude-drive-test-${Date.now()}`);
  const testFile = path.join(testDir, "test.json");

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("writes valid JSON file", () => {
    const data = { key: "value", num: 42, arr: [1, 2, 3] };
    atomicWriteJSON(testFile, data);

    const content = JSON.parse(fs.readFileSync(testFile, "utf-8"));
    expect(content).toEqual(data);
  });

  test("creates parent directories", () => {
    const nested = path.join(testDir, "a", "b", "c", "nested.json");
    atomicWriteJSON(nested, { ok: true });

    const content = JSON.parse(fs.readFileSync(nested, "utf-8"));
    expect(content.ok).toBe(true);
  });

  test("overwrites existing file atomically", () => {
    atomicWriteJSON(testFile, { version: 1 });
    atomicWriteJSON(testFile, { version: 2 });

    const content = JSON.parse(fs.readFileSync(testFile, "utf-8"));
    expect(content.version).toBe(2);
  });

  test("does not leave .tmp file on success", () => {
    atomicWriteJSON(testFile, { clean: true });

    expect(fs.existsSync(testFile + ".tmp")).toBe(false);
    expect(fs.existsSync(testFile)).toBe(true);
  });
});
