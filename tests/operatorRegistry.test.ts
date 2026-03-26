import { jest } from "@jest/globals";
import { OperatorRegistry } from "../src/operatorRegistry.js";

describe("OperatorRegistry", () => {
  let registry: OperatorRegistry;

  beforeEach(() => {
    registry = new OperatorRegistry();
  });

  describe("spawn()", () => {
    it("returns operator with correct defaults", () => {
      const op = registry.spawn("Alpha", "write tests");
      expect(op.name).toBe("Alpha");
      expect(op.task).toBe("write tests");
      expect(op.status).toBe("active");
      expect(op.permissionPreset).toBe("standard");
      expect(op.depth).toBe(0);
    });

    it("auto-assigns name from pool when none provided", () => {
      const op = registry.spawn();
      expect(typeof op.name).toBe("string");
      expect(op.name.length).toBeGreaterThan(0);
    });

    it("second operator spawns as background", () => {
      registry.spawn("Alpha");
      const beta = registry.spawn("Beta");
      expect(beta.status).toBe("background");
    });

    it("applies role template preset", () => {
      const op = registry.spawn("reviewer", "", { role: "reviewer" });
      expect(op.permissionPreset).toBe("readonly");
    });

    it("spawned operator is findable by name", () => {
      registry.spawn("Gamma", "task");
      const found = registry.findByNameOrId("Gamma");
      expect(found).toBeDefined();
      expect(found?.name).toBe("Gamma");
    });
  });

  describe("switchTo()", () => {
    it("switches foreground operator", () => {
      const alpha = registry.spawn("Alpha");
      const beta = registry.spawn("Beta");
      expect(registry.getForeground()?.id).toBe(alpha.id);
      registry.switchTo("Beta");
      expect(registry.getForeground()?.id).toBe(beta.id);
    });

    it("previous foreground moves to background", () => {
      const alpha = registry.spawn("Alpha");
      registry.spawn("Beta");
      registry.switchTo("Beta");
      expect(alpha.status).toBe("background");
    });

    it("returns undefined for unknown operator", () => {
      expect(registry.switchTo("nonexistent")).toBeUndefined();
    });
  });

  describe("dismiss()", () => {
    it("marks operator as completed", () => {
      const op = registry.spawn("Alpha");
      registry.dismiss("Alpha");
      expect(op.status).toBe("completed");
    });

    it("dismissed operator not in getActive()", () => {
      registry.spawn("Alpha");
      registry.dismiss("Alpha");
      expect(registry.getActive().length).toBe(0);
    });

    it("promotes next operator to foreground after dismiss", () => {
      registry.spawn("Alpha");
      const beta = registry.spawn("Beta");
      registry.dismiss("Alpha");
      expect(registry.getForeground()?.id).toBe(beta.id);
    });

    it("returns false for unknown operator", () => {
      expect(registry.dismiss("ghost")).toBe(false);
    });
  });

  describe("getActive()", () => {
    it("excludes completed and merged operators", () => {
      registry.spawn("Alpha");
      registry.spawn("Beta");
      registry.dismiss("Alpha");
      const active = registry.getActive();
      expect(active.length).toBe(1);
      expect(active[0].name).toBe("Beta");
    });
  });

  describe("onDidChange()", () => {
    it("fires listener on spawn", () => {
      const listener = jest.fn();
      registry.onDidChange(listener);
      registry.spawn("Alpha");
      expect(listener).toHaveBeenCalled();
    });

    it("dispose stops listener from firing", () => {
      const listener = jest.fn();
      const { dispose } = registry.onDidChange(listener);
      dispose();
      registry.spawn("Alpha");
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
