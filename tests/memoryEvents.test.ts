import { importSdkMemoryEvent, recall } from "../src/memoryManager.js";
import { memoryStore } from "../src/memoryStore.js";

beforeEach(() => {
  for (const e of memoryStore.getAll()) memoryStore.remove(e.id);
});

describe("importSdkMemoryEvent", () => {
  test("imports each memory as a context-kind entry with scope/mode tags", () => {
    const added = importSdkMemoryEvent("op1", {
      mode: "select",
      memories: [
        { path: "/a.md", scope: "personal", content: "alpha" },
        { path: "/b.md", scope: "team" },
      ],
    });
    expect(added).toHaveLength(2);
    expect(added[0].kind).toBe("context");
    expect(added[0].tags).toContain("sdk-memory");
    expect(added[0].tags).toContain("personal");
    expect(added[0].tags).toContain("select");
    expect(added[0].content).toBe("alpha");
    // Path-only memory falls back to "memory_recall: <path>" content.
    expect(added[1].content).toContain("memory_recall: /b.md");
  });

  test("no-ops on empty/invalid event", () => {
    expect(importSdkMemoryEvent("op", {})).toEqual([]);
    expect(importSdkMemoryEvent("op", { memories: undefined })).toEqual([]);
  });

  test("imported entries are retrievable via recall()", () => {
    importSdkMemoryEvent("op2", {
      mode: "synthesize",
      memories: [{ path: "<synthesis:foo>", scope: "team", content: "synthesized" }],
    });
    const entries = recall("op2", { kinds: ["context"], tags: ["sdk-memory"] });
    expect(entries).toHaveLength(1);
    expect(entries[0].tags).toContain("synthesize");
  });
});
