/**
 * tests/router.test.ts — unit tests for keyword routing in router.ts
 */
import { route } from "../src/router.js";

describe("route — explicit command", () => {
  test("/plan command → plan mode", () => {
    const result = route({ prompt: "whatever", command: "plan" });
    expect(result.mode).toBe("plan");
    expect(result.reason).toContain("plan");
  });

  test("/run command → agent mode", () => {
    const result = route({ prompt: "do something", command: "run" });
    expect(result.mode).toBe("agent");
  });

  test("/drive command → agent mode", () => {
    const result = route({ prompt: "do something", command: "drive" });
    expect(result.mode).toBe("agent");
  });
});

describe("route — driveSubMode", () => {
  test("driveSubMode=plan → plan", () => {
    const result = route({ prompt: "anything", driveSubMode: "plan" });
    expect(result.mode).toBe("plan");
  });

  test("driveSubMode=agent → agent", () => {
    const result = route({ prompt: "anything", driveSubMode: "agent" });
    expect(result.mode).toBe("agent");
  });

  test("driveSubMode=ask → ask", () => {
    const result = route({ prompt: "anything", driveSubMode: "ask" });
    expect(result.mode).toBe("ask");
  });

  test("driveSubMode=direct → ask (mapped)", () => {
    const result = route({ prompt: "anything", driveSubMode: "direct" });
    expect(result.mode).toBe("ask");
  });

  test("driveSubMode=debug → debug", () => {
    const result = route({ prompt: "anything", driveSubMode: "debug" });
    expect(result.mode).toBe("debug");
  });
});

describe("route — keyword detection", () => {
  test("plan keyword → plan mode", () => {
    const result = route({ prompt: "can you plan the next sprint?" });
    expect(result.mode).toBe("plan");
  });

  test("architecture keyword → plan mode", () => {
    const result = route({ prompt: "explain the architecture of this system" });
    expect(result.mode).toBe("plan");
  });

  test("design keyword → plan mode", () => {
    const result = route({ prompt: "design a new data model" });
    expect(result.mode).toBe("plan");
  });

  test("implement keyword → agent mode", () => {
    const result = route({ prompt: "implement the new login flow" });
    expect(result.mode).toBe("agent");
  });

  test("fix keyword → agent mode", () => {
    const result = route({ prompt: "fix the bug in auth.ts" });
    expect(result.mode).toBe("agent");
  });

  test("refactor keyword → agent mode", () => {
    const result = route({ prompt: "refactor the database module" });
    expect(result.mode).toBe("agent");
  });

  test("create keyword → agent mode", () => {
    const result = route({ prompt: "create a new API endpoint" });
    expect(result.mode).toBe("agent");
  });

  test("debug keyword → debug mode", () => {
    const result = route({ prompt: "debug the memory leak" });
    expect(result.mode).toBe("debug");
  });

  test("why does keyword → debug mode", () => {
    const result = route({ prompt: "why does the test fail on CI?" });
    expect(result.mode).toBe("debug");
  });

  test("diagnose keyword → debug mode", () => {
    const result = route({ prompt: "diagnose the slow query" });
    expect(result.mode).toBe("debug");
  });

  test("plan keyword takes priority over agent keywords", () => {
    const result = route({ prompt: "plan and implement the feature" });
    expect(result.mode).toBe("plan");
  });

  test("debug keyword takes priority over agent keywords", () => {
    const result = route({ prompt: "debug and run the tests" });
    expect(result.mode).toBe("debug");
  });

  test("no keyword → ask (default)", () => {
    const result = route({ prompt: "hello" });
    expect(result.mode).toBe("ask");
  });

  test("ambiguous prompt → ask (default)", () => {
    const result = route({ prompt: "what time is it?" });
    expect(result.mode).toBe("ask");
  });
});

describe("route — result shape", () => {
  test("result always has mode and reason", () => {
    const result = route({ prompt: "some random prompt" });
    expect(result.mode).toBeDefined();
    expect(result.reason).toBeDefined();
    expect(typeof result.reason).toBe("string");
  });
});
