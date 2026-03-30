import { isToolAllowedForPreset, checkPermission } from "../src/toolAllowlist.js";

describe("isToolAllowedForPreset()", () => {
  describe("readonly preset", () => {
    it("allows operator_list", () => {
      expect(isToolAllowedForPreset("operator_list", "readonly")).toBe(true);
    });

    it("allows drive_get_state", () => {
      expect(isToolAllowedForPreset("drive_get_state", "readonly")).toBe(true);
    });

    it("allows agent_screen_activity", () => {
      expect(isToolAllowedForPreset("agent_screen_activity", "readonly")).toBe(true);
    });

    it("rejects operator_spawn", () => {
      expect(isToolAllowedForPreset("operator_spawn", "readonly")).toBe(false);
    });

    it("rejects drive_run_task", () => {
      expect(isToolAllowedForPreset("drive_run_task", "readonly")).toBe(false);
    });

    it("rejects an unknown tool", () => {
      expect(isToolAllowedForPreset("some_random_tool", "readonly")).toBe(false);
    });
  });

  describe("standard preset", () => {
    it("allows operator_spawn", () => {
      expect(isToolAllowedForPreset("operator_spawn", "standard")).toBe(true);
    });

    it("allows drive_run_task", () => {
      expect(isToolAllowedForPreset("drive_run_task", "standard")).toBe(true);
    });

    it("allows readonly tools like operator_list", () => {
      expect(isToolAllowedForPreset("operator_list", "standard")).toBe(true);
    });

    it("allows operator_switch", () => {
      expect(isToolAllowedForPreset("operator_switch", "standard")).toBe(true);
    });

    it("rejects a non-listed tool", () => {
      expect(isToolAllowedForPreset("some_random_tool", "standard")).toBe(false);
    });
  });

  describe("full preset", () => {
    it("allows any tool via wildcard", () => {
      expect(isToolAllowedForPreset("some_random_tool", "full")).toBe(true);
    });

    it("allows operator_spawn", () => {
      expect(isToolAllowedForPreset("operator_spawn", "full")).toBe(true);
    });

    it("allows a completely made-up tool name", () => {
      expect(isToolAllowedForPreset("xyz_nonexistent_tool_999", "full")).toBe(true);
    });
  });
});

describe("checkPermission()", () => {
  // Default preset is "standard" (from config defaults)

  it("allows fileRead for default (standard) agent", () => {
    expect(checkPermission("testAgent", "fileRead")).toBe(true);
  });

  it("allows fileWrite for default (standard) agent", () => {
    expect(checkPermission("testAgent", "fileWrite")).toBe(true);
  });

  it("allows gitRead for default (standard) agent", () => {
    expect(checkPermission("testAgent", "gitRead")).toBe(true);
  });

  it("allows terminalExecute for default (standard) agent", () => {
    expect(checkPermission("testAgent", "terminalExecute")).toBe(true);
  });

  it("rejects webSearch for default (standard) agent", () => {
    expect(checkPermission("testAgent", "webSearch")).toBe(false);
  });

  it("allows modelCall for default (standard) agent", () => {
    expect(checkPermission("testAgent", "modelCall")).toBe(true);
  });
});
