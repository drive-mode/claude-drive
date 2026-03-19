import { jest } from "@jest/globals";

const mockGet = jest.fn();
const mockUpdate = jest.fn();

jest.unstable_mockModule("../src/store.js", () => ({
  store: {
    get: mockGet,
    update: mockUpdate,
  },
}));

let createDriveModeManager: typeof import("../src/driveMode.js").createDriveModeManager;

beforeAll(async () => {
  mockGet.mockImplementation((_key: string, defaultVal: unknown) => defaultVal);
  ({ createDriveModeManager } = await import("../src/driveMode.js"));
});

beforeEach(() => {
  mockGet.mockClear();
  mockUpdate.mockClear();
  mockGet.mockImplementation((_key: string, defaultVal: unknown) => defaultVal);
});

describe("DriveModeManager", () => {
  describe("initial state", () => {
    it("starts inactive with default subMode", () => {
      const m = createDriveModeManager();
      expect(m.active).toBe(false);
      expect(m.subMode).toBe("agent");
    });
  });

  describe("setActive()", () => {
    it("sets active to true", () => {
      const m = createDriveModeManager();
      m.setActive(true);
      expect(m.active).toBe(true);
    });

    it("calls store.update with the new value", () => {
      const m = createDriveModeManager();
      m.setActive(true);
      expect(mockUpdate).toHaveBeenCalledWith("drive.active", true);
    });

    it("is a no-op when value is the same", () => {
      const m = createDriveModeManager();
      m.setActive(false); // already false
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("setSubMode()", () => {
    it("updates subMode", () => {
      const m = createDriveModeManager();
      m.setSubMode("plan");
      expect(m.subMode).toBe("plan");
    });

    it("emits change event", () => {
      const m = createDriveModeManager();
      const listener = jest.fn();
      m.on("change", listener);
      m.setSubMode("debug");
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ subMode: "debug" }));
    });

    it("is a no-op when mode is the same", () => {
      const m = createDriveModeManager();
      const listener = jest.fn();
      m.on("change", listener);
      m.setSubMode("agent"); // already "agent"
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("toggle()", () => {
    it("flips active from false to true", () => {
      const m = createDriveModeManager();
      m.toggle();
      expect(m.active).toBe(true);
    });

    it("flips active from true to false", () => {
      const m = createDriveModeManager();
      m.setActive(true);
      mockUpdate.mockClear();
      m.toggle();
      expect(m.active).toBe(false);
    });

    it("emits change event on toggle", () => {
      const m = createDriveModeManager();
      const listener = jest.fn();
      m.on("change", listener);
      m.toggle();
      expect(listener).toHaveBeenCalled();
    });
  });

  describe("on()/off()", () => {
    it("listener receives DriveState on change", () => {
      const m = createDriveModeManager();
      const received: unknown[] = [];
      const listener = (s: unknown) => received.push(s);
      m.on("change", listener as never);
      m.setActive(true);
      expect(received.length).toBe(1);
      expect(received[0]).toMatchObject({ active: true });
    });

    it("off() removes listener", () => {
      const m = createDriveModeManager();
      const listener = jest.fn();
      m.on("change", listener);
      m.off("change", listener);
      m.setActive(true);
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
