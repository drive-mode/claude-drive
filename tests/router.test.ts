import { route } from "../src/router.js";

describe("route()", () => {
  it("returns plan mode for planning keywords", () => {
    const r = route({ prompt: "plan out the new feature" });
    expect(r.mode).toBe("plan");
  });

  it("returns agent mode for action keywords", () => {
    const r = route({ prompt: "implement the login endpoint" });
    expect(r.mode).toBe("agent");
  });

  it("returns debug mode for debug keywords", () => {
    const r = route({ prompt: "debug why the tests are failing" });
    expect(r.mode).toBe("debug");
  });

  it("returns ask mode when no strong signal", () => {
    const r = route({ prompt: "hello there" });
    expect(r.mode).toBe("ask");
  });

  it("explicit /plan command overrides keyword analysis", () => {
    const r = route({ prompt: "implement something", command: "plan" });
    expect(r.mode).toBe("plan");
    expect(r.reason).toContain("Explicit");
  });

  it("explicit /run command returns agent mode", () => {
    const r = route({ prompt: "hello", command: "run" });
    expect(r.mode).toBe("agent");
  });

  it("driveSubMode override wins over keyword analysis", () => {
    const r = route({ prompt: "implement something", driveSubMode: "ask" });
    expect(r.mode).toBe("ask");
  });

  it("driveSubMode debug wins", () => {
    const r = route({ prompt: "plan something", driveSubMode: "debug" });
    expect(r.mode).toBe("debug");
  });

  it("includes a reason string", () => {
    const r = route({ prompt: "refactor the auth module" });
    expect(typeof r.reason).toBe("string");
    expect(r.reason.length).toBeGreaterThan(0);
  });
});
