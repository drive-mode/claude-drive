import { MemoryStore } from "../src/memoryStore.js";
import { runDreamCycle } from "../src/autoDream.js";
import { AutoDreamDaemon } from "../src/autoDream.js";

// We need to use the singleton for the dream cycle
import { memoryStore } from "../src/memoryStore.js";

describe("Auto-Dream", () => {
  beforeEach(() => {
    // Clear all entries from the singleton store
    for (const e of memoryStore.getAll()) {
      memoryStore.remove(e.id);
    }
  });

  test("prunes low confidence entries", () => {
    // Add entries with very low confidence
    for (let i = 0; i < 12; i++) {
      memoryStore.add({
        kind: "fact",
        content: `low conf fact ${i}`,
        source: "test",
        tags: [],
        confidence: i < 5 ? 0.1 : 0.8, // 5 low, 7 high
      });
    }

    const result = runDreamCycle({ pruneThreshold: 0.2, minEntriesForDream: 5, mergeThreshold: 0.99 });
    expect(result.pruned).toBe(5);
    expect(memoryStore.getAll().length).toBe(7);
  });

  test("prunes expired entries", () => {
    for (let i = 0; i < 12; i++) {
      memoryStore.add({
        kind: "fact",
        content: `fact ${i}`,
        source: "test",
        tags: [],
        confidence: 0.8,
        expiresAt: i < 3 ? Date.now() - 1000 : undefined, // 3 expired
      });
    }

    const result = runDreamCycle({ pruneThreshold: 0.01, minEntriesForDream: 5, mergeThreshold: 0.99 });
    expect(result.pruned).toBe(3);
  });

  test("merges similar entries", () => {
    // Add enough base entries to meet minimum
    for (let i = 0; i < 8; i++) {
      memoryStore.add({
        kind: "context",
        content: `unique context item number ${i} with distinctive words`,
        source: "test",
        tags: [],
        confidence: 0.8,
      });
    }
    // Add two very similar entries
    memoryStore.add({
      kind: "fact",
      content: "The project uses TypeScript for all source files",
      source: "test",
      tags: [],
      confidence: 0.8,
    });
    memoryStore.add({
      kind: "fact",
      content: "The project uses TypeScript for all source code files",
      source: "test",
      tags: [],
      confidence: 0.7,
    });

    const result = runDreamCycle({ pruneThreshold: 0.01, minEntriesForDream: 5, mergeThreshold: 0.6 });
    expect(result.merged).toBeGreaterThanOrEqual(1);
  });

  test("promotes cross-operator entries to shared", () => {
    // Add enough entries to meet minimum
    for (let i = 0; i < 8; i++) {
      memoryStore.add({
        kind: "context",
        content: `unique filler context item number ${i} with distinctive words for padding`,
        source: "test",
        tags: [],
        confidence: 0.8,
      });
    }
    // Same content from two different operators — the promote step checks exact
    // content match (lowercase+trim). Set mergeThreshold very high to prevent
    // the merge step from superseding one before the promote step runs.
    // However, similarity=1.0 for identical content, so we can't prevent merge.
    // Instead, we need merge to NOT apply across different operators' entries
    // or we need different content. Actually the promote step happens AFTER merge,
    // so we should check that it still works.
    // Use content that differs enough to avoid merge but matches exactly for promote.
    const sharedContent = "npm run compile builds the project";
    memoryStore.add({
      kind: "fact",
      content: sharedContent,
      source: "op-1",
      operatorId: "op-1",
      tags: [],
      confidence: 0.8,
    });
    memoryStore.add({
      kind: "fact",
      content: sharedContent,
      source: "op-2",
      operatorId: "op-2",
      tags: [],
      confidence: 0.8,
    });

    // Use a very high merge threshold AND run with merge disabled effectively
    // by disabling the similarity check (threshold > 1.0)
    const result = runDreamCycle({ pruneThreshold: 0.01, minEntriesForDream: 5, mergeThreshold: 1.1 });
    expect(result.promoted).toBeGreaterThanOrEqual(1);

    // Check that one entry is now shared
    const shared = memoryStore.getAll().filter((e) => !e.operatorId && e.content.includes("npm run compile"));
    expect(shared.length).toBeGreaterThanOrEqual(1);
  });

  test("skips when too few entries", () => {
    memoryStore.add({ kind: "fact", content: "only one", source: "test", tags: [], confidence: 0.8 });

    const result = runDreamCycle({ minEntriesForDream: 10 });
    expect(result.summary).toBe("Too few entries to dream.");
    expect(result.pruned).toBe(0);
  });

  test("daemon start and stop", () => {
    const daemon = new AutoDreamDaemon();
    expect(daemon.isRunning()).toBe(false);

    // Don't actually start (would set timers), just test the interface
    daemon.stop();
    expect(daemon.isRunning()).toBe(false);
    expect(daemon.getLastResult()).toBeNull();
  });

  test("daemon runOnce", () => {
    // Add enough entries
    for (let i = 0; i < 12; i++) {
      memoryStore.add({
        kind: "fact",
        content: `daemon test fact ${i}`,
        source: "test",
        tags: [],
        confidence: 0.8,
      });
    }

    const daemon = new AutoDreamDaemon();
    const result = daemon.runOnce();
    expect(result).toBeDefined();
    expect(result.timestamp).toBeGreaterThan(0);
    expect(daemon.getLastResult()).toBe(result);
  });
});
