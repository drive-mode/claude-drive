import os from "os";
import fs from "fs/promises";
import path from "path";
import { PersistentMemory } from "../src/persistentMemory.js";

describe("PersistentMemory", () => {
  let tmpDir: string;
  let memory: PersistentMemory;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cd-test-"));
    memory = new PersistentMemory(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("buildPromptContext on empty dir returns empty string", async () => {
    const ctx = await memory.buildPromptContext();
    expect(ctx).toBe("");
  });

  it("writeCurated then readCurated round-trips content", async () => {
    await memory.writeCurated("Harrison prefers Python.");
    const result = await memory.readCurated();
    expect(result).toContain("Harrison prefers Python.");
  });

  it("readCurated returns null when no file exists", async () => {
    const result = await memory.readCurated();
    expect(result).toBeNull();
  });

  it("appendToDaily creates a dated file and buildPromptContext includes it", async () => {
    await memory.appendToDaily("deployed v2.0", "ops-agent");
    const ctx = await memory.buildPromptContext();
    expect(ctx).toContain("deployed v2.0");
    expect(ctx).toContain("ops-agent");
  });

  it("buildPromptContext includes curated and daily content", async () => {
    await memory.writeCurated("Long-term fact.");
    await memory.appendToDaily("Daily note.");
    const ctx = await memory.buildPromptContext();
    expect(ctx).toContain("Long-term memory");
    expect(ctx).toContain("Long-term fact.");
    expect(ctx).toContain("Daily note.");
  });

  it("search finds keywords in daily logs", async () => {
    await memory.appendToDaily("migrated database to postgres");
    const results = await memory.search("postgres");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet).toContain("postgres");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("search returns empty for no matches", async () => {
    await memory.appendToDaily("nothing relevant here");
    const results = await memory.search("xyznonexistent");
    expect(results).toHaveLength(0);
  });

  it("search returns empty for short query tokens", async () => {
    await memory.appendToDaily("a b c");
    // All tokens <= 2 chars are filtered out
    const results = await memory.search("a b");
    expect(results).toHaveLength(0);
  });

  it("appendToDaily without agent omits agent bracket", async () => {
    await memory.appendToDaily("bare note");
    const ctx = await memory.buildPromptContext();
    expect(ctx).toContain("bare note");
    // Should have timestamp bracket but not a double bracket for agent
    expect(ctx).not.toContain("[]");
  });
});
