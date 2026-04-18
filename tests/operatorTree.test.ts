import { OperatorRegistry } from "../src/operatorRegistry.js";
import { saveConfig } from "../src/config.js";

describe("OperatorRegistry — nesting & tree", () => {
  test("getChildren returns direct children only", () => {
    const reg = new OperatorRegistry();
    const root = reg.spawn("root");
    const child1 = reg.spawn("c1", "", { parentId: root.id });
    const child2 = reg.spawn("c2", "", { parentId: root.id });
    const grandchild = reg.spawn("gc", "", { parentId: child1.id });

    const kids = reg.getChildren(root.id).map((o) => o.name).sort();
    expect(kids).toEqual(["c1", "c2"]);
    const grandKids = reg.getChildren(child1.id).map((o) => o.name);
    expect(grandKids).toEqual(["gc"]);
    expect(reg.getChildren(child2.id)).toEqual([]);
    expect(grandchild.parentId).toBe(child1.id);
  });

  test("getTree builds a recursive forest", () => {
    const reg = new OperatorRegistry();
    const a = reg.spawn("a");
    reg.spawn("b", "", { parentId: a.id });
    const c = reg.spawn("c"); // sibling root
    reg.spawn("d", "", { parentId: c.id });

    const tree = reg.getTree();
    expect(tree.map((n) => n.op.name).sort()).toEqual(["a", "c"]);
    const aNode = tree.find((n) => n.op.name === "a")!;
    expect(aNode.children.map((n) => n.op.name)).toEqual(["b"]);
    expect(aNode.children[0].children).toEqual([]);
  });

  test("getTree(rootName) returns a single-rooted tree", () => {
    const reg = new OperatorRegistry();
    const a = reg.spawn("root");
    reg.spawn("kid", "", { parentId: a.id });
    const rooted = reg.getTree("root");
    expect(rooted).toHaveLength(1);
    expect(rooted[0].children.map((n) => n.op.name)).toEqual(["kid"]);
  });

  test("spawn clamps depth to configured maxDepth with a memory marker", () => {
    saveConfig("operators.maxDepth", 2);
    try {
      const reg = new OperatorRegistry();
      const r = reg.spawn("r");
      const c1 = reg.spawn("c1", "", { parentId: r.id });
      const c2 = reg.spawn("c2", "", { parentId: c1.id });
      // requested depth would be 3 (> maxDepth 2) → clamped to 2
      const c3 = reg.spawn("c3", "", { parentId: c2.id });
      expect(c3.depth).toBe(2);
      expect(c3.memory.some((m) => m.includes("clamped-depth"))).toBe(true);
    } finally {
      saveConfig("operators.maxDepth", 3); // reset
    }
  });
});

describe("OperatorRegistry — new OperatorContext fields", () => {
  test("first root operator defaults to foreground executionMode", () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("alpha");
    expect(op.executionMode).toBe("foreground");
  });

  test("subsequent root operators default to background executionMode", () => {
    const reg = new OperatorRegistry();
    reg.spawn("first");
    const second = reg.spawn("second");
    expect(second.executionMode).toBe("background");
  });

  test("executionMode option overrides default", () => {
    const reg = new OperatorRegistry();
    reg.spawn("first");
    const op = reg.spawn("forced", "", { executionMode: "foreground" });
    expect(op.executionMode).toBe("foreground");
  });

  test("effort and agentDefinitionName stick on the context", () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("x", "", { effort: "high", agentDefinitionName: "researcher" });
    expect(op.effort).toBe("high");
    expect(op.agentDefinitionName).toBe("researcher");
  });

  test("updateContextUsage stores the usage snapshot", () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("u");
    const ok = reg.updateContextUsage(op.id, {
      total: 123, maxTokens: 1000, percentage: 12.3,
      byCategory: { system: 50, messages: 73 }, updatedAt: 1,
    });
    expect(ok).toBe(true);
    expect(op.contextUsage?.total).toBe(123);
    expect(op.contextUsage?.byCategory.system).toBe(50);
  });

  test("setRunPromise and markStatus work", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("p");
    reg.setRunPromise(op.id, Promise.resolve());
    expect(op.runPromise).toBeDefined();
    reg.markStatus(op.id, "completed");
    expect(op.status).toBe("completed");
  });
});
