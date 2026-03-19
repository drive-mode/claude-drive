import { jest } from "@jest/globals";

const mockSaveSession = jest.fn();
const mockLoadSession = jest.fn();
const mockListSessions = jest.fn<() => unknown[]>().mockReturnValue([]);

jest.unstable_mockModule("../src/sessionStore.js", () => ({
  saveSession: mockSaveSession,
  loadSession: mockLoadSession,
  listSessions: mockListSessions,
}));

const { createSession, resumeSession, listSessions } = await import("../src/sessionManager.js");
import type { OperatorRegistry } from "../src/operatorRegistry.js";
import type { DriveModeManager } from "../src/driveMode.js";

function createMockRegistry(operators: unknown[] = []) {
  return {
    list: jest.fn<() => unknown[]>().mockReturnValue(operators),
    spawn: jest.fn(),
  };
}

function createMockDriveMode(active = true, subMode = "agent") {
  return {
    active,
    subMode,
    setActive: jest.fn(),
    setSubMode: jest.fn(),
  };
}

describe("sessionManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createSession()", () => {
    it("saves a snapshot with generated id", () => {
      const registry = createMockRegistry([]);
      const driveMode = createMockDriveMode(true, "plan");

      const id = createSession(
        registry as unknown as OperatorRegistry,
        driveMode as unknown as DriveModeManager,
        "my-session"
      );

      expect(id).toMatch(/^session-\d+-[a-z0-9]+$/);
      expect(mockSaveSession).toHaveBeenCalledTimes(1);

      const snapshot = mockSaveSession.mock.calls[0][0] as Record<string, unknown>;
      expect(snapshot.id).toBe(id);
      expect(snapshot.name).toBe("my-session");
      expect(snapshot.driveMode).toEqual({ active: true, subMode: "plan" });
      expect(snapshot.operators).toEqual([]);
    });

    it("includes operators in snapshot", () => {
      const ops = [
        { name: "Alpha", task: "write code", status: "active" },
        { name: "Beta", task: "review", status: "background" },
      ];
      const registry = createMockRegistry(ops);
      const driveMode = createMockDriveMode();

      createSession(registry as unknown as OperatorRegistry, driveMode as unknown as DriveModeManager);

      const snapshot = mockSaveSession.mock.calls[0][0] as Record<string, unknown>;
      expect(snapshot.operators).toEqual(ops);
    });

    it("works without a name", () => {
      const registry = createMockRegistry();
      const driveMode = createMockDriveMode();

      const id = createSession(registry as unknown as OperatorRegistry, driveMode as unknown as DriveModeManager);

      expect(id).toBeTruthy();
      const snapshot = mockSaveSession.mock.calls[0][0] as Record<string, unknown>;
      expect(snapshot.name).toBeUndefined();
    });
  });

  describe("resumeSession()", () => {
    it("restores drive mode and spawns operators", () => {
      const snapshot = {
        id: "session-123",
        createdAt: Date.now(),
        driveMode: { active: true, subMode: "debug" },
        operators: [
          { name: "Alpha", task: "fix bug", status: "active", role: "implementer", permissionPreset: "standard", depth: 0 },
        ],
        activityLog: [],
      };
      mockLoadSession.mockReturnValue(snapshot);

      const registry = createMockRegistry();
      const driveMode = createMockDriveMode();

      const result = resumeSession("session-123", registry as unknown as OperatorRegistry, driveMode as unknown as DriveModeManager);

      expect(result).toBe(true);
      expect(driveMode.setActive).toHaveBeenCalledWith(true);
      expect(driveMode.setSubMode).toHaveBeenCalledWith("debug");
      expect(registry.spawn).toHaveBeenCalledWith("Alpha", "fix bug", {
        role: "implementer",
        preset: "standard",
        parentId: undefined,
        depth: 0,
      });
    });

    it("returns false when session not found", () => {
      mockLoadSession.mockReturnValue(undefined);
      const registry = createMockRegistry();
      const driveMode = createMockDriveMode();

      const result = resumeSession("nonexistent", registry as unknown as OperatorRegistry, driveMode as unknown as DriveModeManager);

      expect(result).toBe(false);
      expect(driveMode.setActive).not.toHaveBeenCalled();
    });

    it("skips completed and merged operators", () => {
      const snapshot = {
        id: "session-456",
        createdAt: Date.now(),
        driveMode: { active: false, subMode: "off" },
        operators: [
          { name: "Alpha", task: "done", status: "completed", depth: 0 },
          { name: "Beta", task: "merged", status: "merged", depth: 0 },
          { name: "Gamma", task: "still going", status: "active", role: undefined, permissionPreset: "standard", depth: 0 },
        ],
        activityLog: [],
      };
      mockLoadSession.mockReturnValue(snapshot);

      const registry = createMockRegistry();
      const driveMode = createMockDriveMode();

      resumeSession("session-456", registry as unknown as OperatorRegistry, driveMode as unknown as DriveModeManager);

      expect(registry.spawn).toHaveBeenCalledTimes(1);
      expect(registry.spawn).toHaveBeenCalledWith("Gamma", "still going", expect.objectContaining({ depth: 0 }));
    });

    it("continues if an operator fails to restore", () => {
      const snapshot = {
        id: "session-789",
        createdAt: Date.now(),
        driveMode: { active: true, subMode: "agent" },
        operators: [
          { name: "Bad", task: "explodes", status: "active", depth: 0 },
          { name: "Good", task: "works", status: "active", depth: 0 },
        ],
        activityLog: [],
      };
      mockLoadSession.mockReturnValue(snapshot);

      const registry = createMockRegistry();
      registry.spawn.mockImplementationOnce(() => { throw new Error("spawn failed"); });
      const driveMode = createMockDriveMode();

      const result = resumeSession("session-789", registry as unknown as OperatorRegistry, driveMode as unknown as DriveModeManager);

      expect(result).toBe(true);
      expect(registry.spawn).toHaveBeenCalledTimes(2);
    });
  });

  describe("listSessions()", () => {
    it("delegates to sessionStore.listSessions", () => {
      const sessions = [
        { id: "s1", createdAt: 2, driveMode: { active: true, subMode: "agent" }, operators: [], activityLog: [] },
        { id: "s2", createdAt: 1, driveMode: { active: false, subMode: "off" }, operators: [], activityLog: [] },
      ];
      mockListSessions.mockReturnValue(sessions);

      const result = listSessions();

      expect(result).toBe(sessions);
    });
  });
});
