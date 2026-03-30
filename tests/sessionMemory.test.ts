import { SessionMemory } from "../src/sessionMemory.js";
import type { OperatorVisibility } from "../src/sessionMemory.js";

describe("SessionMemory", () => {
  let memory: SessionMemory;

  beforeEach(() => {
    memory = new SessionMemory();
    memory.clear();
  });

  afterEach(() => {
    memory.clear();
  });

  it("fresh memory buildContextString returns empty string", () => {
    expect(memory.buildContextString()).toBe("");
  });

  it("addDecision then buildContextString includes the decision text", () => {
    memory.addDecision("use postgres");
    const ctx = memory.buildContextString();
    expect(ctx).toContain("use postgres");
  });

  it("addTask then buildContextString includes Active tasks", () => {
    memory.addTask("write tests");
    const ctx = memory.buildContextString();
    expect(ctx).toContain("Active tasks:");
    expect(ctx).toContain("write tests");
  });

  it("completeTask removes from active tasks", () => {
    memory.addTask("deploy");
    memory.completeTask("deploy");
    const state = memory.getState();
    expect(state.activeTasks).not.toContain("deploy");
  });

  it("addTurn then buildContextString includes the summary", () => {
    memory.addTurn("refactored auth module", "alice");
    const ctx = memory.buildContextString();
    expect(ctx).toContain("refactored auth module");
  });

  it("buildContextForOperator with isolated visibility only shows entries from that agent", () => {
    memory.addDecision("decision from alice", "alice");
    memory.addDecision("decision from bob", "bob");
    const ctx = memory.buildContextForOperator("alice", "isolated");
    expect(ctx).toContain("decision from alice");
    expect(ctx).not.toContain("decision from bob");
  });

  it("buildContextForOperator with collaborative visibility labels other operators decisions", () => {
    memory.addDecision("my insight", "alice");
    memory.addDecision("bobs insight", "bob");
    const ctx = memory.buildContextForOperator("alice", "collaborative");
    expect(ctx).toContain("bobs insight");
    expect(ctx).toContain("[bob]");
    expect(ctx).toContain("my insight");
  });

  it("buildContextForOperator with shared visibility shows all entries", () => {
    memory.addDecision("decision A", "alice");
    memory.addDecision("decision B", "bob");
    const ctx = memory.buildContextForOperator("alice", "shared");
    expect(ctx).toContain("decision A");
    expect(ctx).toContain("decision B");
  });

  it("clear() resets all state", () => {
    memory.addDecision("something");
    memory.addTask("do stuff");
    memory.clear();
    const state = memory.getState();
    expect(state.entries).toHaveLength(0);
    expect(state.activeTasks).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
    expect(memory.buildContextString()).toBe("");
  });

  it("compact() reduces entries when threshold is reached", () => {
    // Add enough entries to trigger compaction (default maxEntries=50, threshold=80% = 40)
    for (let i = 0; i < 45; i++) {
      memory.addTurn(`turn ${i}`, "agent");
    }
    // Compaction should have already been triggered by push()
    const state = memory.getState();
    // After compaction, entries should be fewer than what we added
    expect(state.entries.length).toBeLessThan(45);
    // Should contain a compaction-summary entry
    const hasSummary = state.entries.some((e) => e.type === "compaction-summary");
    expect(hasSummary).toBe(true);
  });

  it("getState returns readonly state", () => {
    memory.addTask("test task");
    const state = memory.getState();
    expect(state.activeTasks).toContain("test task");
  });

  it("addTask does not duplicate existing task", () => {
    memory.addTask("unique-task");
    memory.addTask("unique-task");
    const state = memory.getState();
    const count = state.activeTasks.filter((t) => t === "unique-task").length;
    expect(count).toBe(1);
  });
});
