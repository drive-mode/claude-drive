import { saveSession, loadSession, listSessions, deleteSession } from "../src/sessionStore.js";
import type { SessionSnapshot } from "../src/sessionStore.js";

function makeSnapshot(id: string): SessionSnapshot {
  return {
    id,
    createdAt: Date.now(),
    driveMode: { active: true, subMode: "agent" },
    operators: [],
    activityLog: [],
  };
}

describe("sessionStore", () => {
  const testIds: string[] = [];

  function trackId(id: string): string {
    testIds.push(id);
    return id;
  }

  afterEach(() => {
    for (const id of testIds) {
      try { deleteSession(id); } catch { /* ignore */ }
    }
    testIds.length = 0;
  });

  it("loadSession for non-existent ID returns undefined", () => {
    const result = loadSession("does-not-exist-" + Date.now());
    expect(result).toBeUndefined();
  });

  it("saveSession then loadSession round-trips", () => {
    const id = trackId(`test-rt-${Date.now()}`);
    const snap = makeSnapshot(id);
    snap.name = "round-trip test";
    saveSession(snap);
    const loaded = loadSession(id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(id);
    expect(loaded!.name).toBe("round-trip test");
    expect(loaded!.driveMode.subMode).toBe("agent");
  });

  it("listSessions includes saved session", () => {
    const id = trackId(`test-list-${Date.now()}`);
    saveSession(makeSnapshot(id));
    const sessions = listSessions();
    const found = sessions.find((s) => s.id === id);
    expect(found).toBeDefined();
  });

  it("deleteSession removes it and loadSession returns undefined after", () => {
    const id = trackId(`test-del-${Date.now()}`);
    saveSession(makeSnapshot(id));
    expect(loadSession(id)).toBeDefined();
    const deleted = deleteSession(id);
    expect(deleted).toBe(true);
    expect(loadSession(id)).toBeUndefined();
  });

  it("deleteSession returns false for non-existent ID", () => {
    const result = deleteSession("no-such-session-" + Date.now());
    expect(result).toBe(false);
  });

  it("listSessions returns sorted by createdAt descending", () => {
    const id1 = trackId(`test-sort-a-${Date.now()}`);
    const id2 = trackId(`test-sort-b-${Date.now()}`);
    const snap1 = makeSnapshot(id1);
    snap1.createdAt = 1000;
    const snap2 = makeSnapshot(id2);
    snap2.createdAt = 2000;
    saveSession(snap1);
    saveSession(snap2);
    const sessions = listSessions();
    const idx1 = sessions.findIndex((s) => s.id === id1);
    const idx2 = sessions.findIndex((s) => s.id === id2);
    // snap2 has later createdAt, should come first
    expect(idx2).toBeLessThan(idx1);
  });
});
