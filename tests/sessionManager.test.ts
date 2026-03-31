import { jest } from "@jest/globals";

// Mock sessionStore before importing sessionManager
const mockSaveSession = jest.fn();
const mockLoadSession = jest.fn();
const mockListSessions = jest.fn();

jest.unstable_mockModule("../src/sessionStore.js", () => ({
  saveSession: mockSaveSession,
  loadSession: mockLoadSession,
  listSessions: mockListSessions,
}));

// Dynamic import after mock setup (required for ESM)
const { createSession, resumeSession, listSessions, trackEvent } = await import(
  "../src/sessionManager.js"
);
import { OperatorRegistry } from "../src/operatorRegistry.js";
import { createDriveModeManager } from "../src/driveMode.js";
import type { DriveModeManager } from "../src/driveMode.js";

describe("sessionManager", () => {
  let registry: OperatorRegistry;
  let driveMode: DriveModeManager;

  beforeEach(() => {
    registry = new OperatorRegistry();
    driveMode = createDriveModeManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    driveMode.dispose();
  });

  describe("createSession()", () => {
    it("returns a session ID string", () => {
      const id = createSession(registry, driveMode);
      expect(typeof id).toBe("string");
      expect(id.startsWith("session-")).toBe(true);
    });

    it("calls saveSession with correct snapshot shape", () => {
      driveMode.setActive(true);
      driveMode.setSubMode("plan");
      registry.spawn("Alpha", "do stuff");

      const id = createSession(registry, driveMode, "test-session");

      expect(mockSaveSession).toHaveBeenCalledTimes(1);
      const snapshot = mockSaveSession.mock.calls[0][0];
      expect(snapshot.id).toBe(id);
      expect(snapshot.name).toBe("test-session");
      expect(snapshot.driveMode.active).toBe(true);
      expect(snapshot.driveMode.subMode).toBe("plan");
      expect(snapshot.operators.length).toBe(1);
      expect(snapshot.operators[0].name).toBe("Alpha");
      expect(snapshot.operators[0].task).toBe("do stuff");
      expect(typeof snapshot.createdAt).toBe("number");
      expect(Array.isArray(snapshot.activityLog)).toBe(true);
    });

    it("includes activity log in snapshot", () => {
      trackEvent({ type: "activity", operator: "Alpha", message: "hello" } as never);
      createSession(registry, driveMode);

      const snapshot = mockSaveSession.mock.calls[0][0];
      expect(snapshot.activityLog.length).toBeGreaterThan(0);
    });

    it("creates session without name when not provided", () => {
      const id = createSession(registry, driveMode);
      const snapshot = mockSaveSession.mock.calls[0][0];
      expect(snapshot.name).toBeUndefined();
      expect(snapshot.id).toBe(id);
    });
  });

  describe("resumeSession()", () => {
    it("returns false when session not found", () => {
      mockLoadSession.mockReturnValue(undefined);
      const result = resumeSession("nonexistent", registry, driveMode);
      expect(result).toBe(false);
    });

    it("restores drive mode state from snapshot", () => {
      mockLoadSession.mockReturnValue({
        id: "session-123",
        createdAt: Date.now(),
        driveMode: { active: true, subMode: "debug" },
        operators: [],
        activityLog: [],
      });

      const result = resumeSession("session-123", registry, driveMode);
      expect(result).toBe(true);
      expect(driveMode.active).toBe(true);
      expect(driveMode.subMode).toBe("debug");
    });

    it("restores active operators from snapshot", () => {
      mockLoadSession.mockReturnValue({
        id: "session-456",
        createdAt: Date.now(),
        driveMode: { active: false, subMode: "agent" },
        operators: [
          {
            id: "op-1", name: "Alpha", task: "implement feature",
            status: "active", permissionPreset: "standard",
            depth: 0, memory: [], visibility: "shared", createdAt: 1,
          },
          {
            id: "op-2", name: "Beta", task: "review code",
            status: "background", permissionPreset: "readonly",
            role: "reviewer", depth: 0, memory: [], visibility: "shared", createdAt: 2,
          },
        ],
        activityLog: [],
      });

      const result = resumeSession("session-456", registry, driveMode);
      expect(result).toBe(true);

      const active = registry.getActive();
      expect(active.length).toBe(2);
      expect(active.some((o) => o.name === "Alpha")).toBe(true);
      expect(active.some((o) => o.name === "Beta")).toBe(true);
    });

    it("skips completed and merged operators during restore", () => {
      mockLoadSession.mockReturnValue({
        id: "session-789",
        createdAt: Date.now(),
        driveMode: { active: false, subMode: "agent" },
        operators: [
          {
            id: "op-1", name: "Done", task: "finished",
            status: "completed", permissionPreset: "standard",
            depth: 0, memory: [], visibility: "shared", createdAt: 1,
          },
          {
            id: "op-2", name: "Merged", task: "merged",
            status: "merged", permissionPreset: "standard",
            depth: 0, memory: [], visibility: "shared", createdAt: 2,
          },
          {
            id: "op-3", name: "Active", task: "still going",
            status: "active", permissionPreset: "standard",
            depth: 0, memory: [], visibility: "shared", createdAt: 3,
          },
        ],
        activityLog: [],
      });

      resumeSession("session-789", registry, driveMode);
      const active = registry.getActive();
      expect(active.length).toBe(1);
      expect(active[0].name).toBe("Active");
    });

    it("handles operator restore failure gracefully (does not throw)", () => {
      // Spawn an operator with the same name first to force a rename path,
      // but the real test is that the function doesn't throw even if spawn
      // encounters unexpected conditions.
      mockLoadSession.mockReturnValue({
        id: "session-err",
        createdAt: Date.now(),
        driveMode: { active: false, subMode: "agent" },
        operators: [
          {
            id: "op-1", name: "Alpha", task: "task",
            status: "active", permissionPreset: "standard",
            depth: 0, memory: [], visibility: "shared", createdAt: 1,
          },
        ],
        activityLog: [],
      });

      // Pre-spawn Alpha so the restore attempts to spawn a duplicate name
      registry.spawn("Alpha", "pre-existing");

      // Should not throw - the registry handles name conflicts by renaming
      expect(() => resumeSession("session-err", registry, driveMode)).not.toThrow();
    });
  });

  describe("round-trip: create then resume", () => {
    it("restores operators and mode after create + resume", () => {
      driveMode.setActive(true);
      driveMode.setSubMode("plan");
      registry.spawn("Alpha", "write tests");
      registry.spawn("Beta", "review");

      // Capture the snapshot that createSession would save
      let capturedSnapshot: unknown;
      mockSaveSession.mockImplementation((snap: unknown) => {
        capturedSnapshot = snap;
      });

      createSession(registry, driveMode, "round-trip");

      // Set up loadSession to return the captured snapshot
      mockLoadSession.mockReturnValue(capturedSnapshot);

      // Resume into a fresh registry+driveMode
      const newRegistry = new OperatorRegistry();
      const newDriveMode = createDriveModeManager();

      const result = resumeSession(
        (capturedSnapshot as { id: string }).id,
        newRegistry,
        newDriveMode
      );

      expect(result).toBe(true);
      expect(newDriveMode.active).toBe(true);
      expect(newDriveMode.subMode).toBe("plan");
      expect(newRegistry.getActive().length).toBe(2);

      newDriveMode.dispose();
    });
  });

  describe("listSessions()", () => {
    it("delegates to sessionStore listSessions", () => {
      const mockData = [{ id: "s1", createdAt: 1 }];
      mockListSessions.mockReturnValue(mockData);

      const result = listSessions();
      expect(result).toBe(mockData);
      expect(mockListSessions).toHaveBeenCalledTimes(1);
    });
  });
});
