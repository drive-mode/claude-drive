import { MemoryStore, memoryStore } from "../src/memoryStore.js";
import type { MemoryEntry } from "../src/memoryStore.js";

describe("MemoryStore", () => {
  // Use the singleton to avoid disk-loading issues with fresh instances
  const store = memoryStore;

  beforeEach(() => {
    // Clear all entries to prevent cross-test contamination
    for (const e of store.getAll()) {
      store.remove(e.id);
    }
  });

  test("add and get entry", () => {
    const entry = store.add({
      kind: "fact",
      content: "The project uses ESM",
      source: "op-1",
      operatorId: "op-1",
      tags: ["build"],
      confidence: 0.9,
    });
    expect(entry.id).toBeDefined();
    expect(entry.kind).toBe("fact");
    expect(entry.content).toBe("The project uses ESM");
    expect(entry.createdAt).toBeGreaterThan(0);

    const retrieved = store.get(entry.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.accessCount).toBe(1);
  });

  test("query by kind", () => {
    store.add({ kind: "fact", content: "A", source: "s", tags: [], confidence: 0.8 });
    store.add({ kind: "preference", content: "B", source: "s", tags: [], confidence: 0.8 });
    store.add({ kind: "fact", content: "C", source: "s", tags: [], confidence: 0.8 });

    const facts = store.query({ kinds: ["fact"] });
    expect(facts.length).toBe(2);
    expect(facts.every((e) => e.kind === "fact")).toBe(true);
  });

  test("query by tags", () => {
    store.add({ kind: "fact", content: "A", source: "s", tags: ["ts", "build"], confidence: 0.8 });
    store.add({ kind: "fact", content: "B", source: "s", tags: ["python"], confidence: 0.8 });

    const results = store.query({ tags: ["ts"] });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe("A");
  });

  test("query by search string", () => {
    store.add({ kind: "fact", content: "Uses TypeScript 5.3", source: "s", tags: [], confidence: 0.8 });
    store.add({ kind: "fact", content: "Uses Python 3.12", source: "s", tags: [], confidence: 0.8 });

    const results = store.query({ search: "typescript" });
    expect(results.length).toBe(1);
    expect(results[0].content).toContain("TypeScript");
  });

  test("query excludes superseded entries", () => {
    const a = store.add({ kind: "fact", content: "old fact", source: "s", tags: [], confidence: 0.8 });
    const b = store.add({ kind: "correction", content: "new fact", source: "s", tags: [], confidence: 1.0 });
    store.update(a.id, { supersededBy: b.id });

    const results = store.query({});
    expect(results.length).toBe(1);
    expect(results[0].content).toBe("new fact");
  });

  test("query excludes expired entries by default", () => {
    store.add({ kind: "fact", content: "fresh", source: "s", tags: [], confidence: 0.8 });
    store.add({ kind: "fact", content: "expired", source: "s", tags: [], confidence: 0.8, expiresAt: Date.now() - 1000 });

    const results = store.query({});
    expect(results.length).toBe(1);
    expect(results[0].content).toBe("fresh");
  });

  test("query with limit", () => {
    for (let i = 0; i < 10; i++) {
      store.add({ kind: "fact", content: `item ${i}`, source: "s", tags: [], confidence: 0.8 });
    }
    const results = store.query({ limit: 3 });
    expect(results.length).toBe(3);
  });

  test("update entry fields", () => {
    const entry = store.add({ kind: "fact", content: "old", source: "s", tags: [], confidence: 0.5 });
    const ok = store.update(entry.id, { content: "new", confidence: 0.9, tags: ["updated"] });
    expect(ok).toBe(true);

    const updated = store.get(entry.id);
    expect(updated!.content).toBe("new");
    expect(updated!.confidence).toBe(0.9);
    expect(updated!.tags).toEqual(["updated"]);
  });

  test("remove entry", () => {
    const entry = store.add({ kind: "fact", content: "doomed", source: "s", tags: [], confidence: 0.8 });
    expect(store.remove(entry.id)).toBe(true);
    expect(store.get(entry.id)).toBeUndefined();
    expect(store.remove(entry.id)).toBe(false);
  });

  test("getForOperator returns operator-scoped and shared entries", () => {
    store.add({ kind: "fact", content: "op1 fact", source: "s", operatorId: "op-1", tags: [], confidence: 0.8 });
    store.add({ kind: "fact", content: "shared fact", source: "s", tags: [], confidence: 0.8 });
    store.add({ kind: "fact", content: "op2 fact", source: "s", operatorId: "op-2", tags: [], confidence: 0.8 });

    const results = store.getForOperator("op-1");
    expect(results.length).toBe(2); // op1's own + shared
    expect(results.some((e) => e.content === "op2 fact")).toBe(false);
  });

  test("getShared returns only global entries", () => {
    store.add({ kind: "fact", content: "shared", source: "s", tags: [], confidence: 0.8 });
    store.add({ kind: "fact", content: "scoped", source: "s", operatorId: "op-1", tags: [], confidence: 0.8 });

    const results = store.getShared();
    expect(results.length).toBe(1);
    expect(results[0].content).toBe("shared");
  });

  test("stats returns counts", () => {
    store.add({ kind: "fact", content: "a", source: "s", operatorId: "op-1", tags: [], confidence: 0.8 });
    store.add({ kind: "preference", content: "b", source: "s", tags: [], confidence: 0.8 });
    store.add({ kind: "fact", content: "c", source: "s", operatorId: "op-1", tags: [], confidence: 0.8 });

    const stats = store.stats();
    expect(stats.total).toBe(3);
    expect(stats.byKind.fact).toBe(2);
    expect(stats.byKind.preference).toBe(1);
    expect(stats.byOperator["op-1"]).toBe(2);
    expect(stats.byOperator["shared"]).toBe(1);
  });

  test("sort order: corrections first, then by confidence", () => {
    store.add({ kind: "fact", content: "low conf", source: "s", tags: [], confidence: 0.3 });
    store.add({ kind: "correction", content: "correction", source: "s", tags: [], confidence: 0.5 });
    store.add({ kind: "fact", content: "high conf", source: "s", tags: [], confidence: 0.9 });

    const results = store.query({});
    expect(results[0].kind).toBe("correction");
    expect(results[1].content).toBe("high conf");
    expect(results[2].content).toBe("low conf");
  });
});
