import { HookRegistry } from "../src/hooks.js";
import type { HookDefinition, HookContext } from "../src/hooks.js";

describe("HookRegistry", () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  test("register and list hooks", () => {
    registry.register({
      id: "test-hook",
      event: "PostToolUse",
      type: "prompt",
      prompt: "Always check tests",
    });

    const hooks = registry.list();
    expect(hooks.length).toBe(1);
    expect(hooks[0].id).toBe("test-hook");
  });

  test("list filters by event", () => {
    registry.register({ id: "h1", event: "PostToolUse", type: "prompt", prompt: "a" });
    registry.register({ id: "h2", event: "PreToolUse", type: "prompt", prompt: "b" });
    registry.register({ id: "h3", event: "PostToolUse", type: "prompt", prompt: "c" });

    const post = registry.list("PostToolUse");
    expect(post.length).toBe(2);
    expect(post.every((h) => h.event === "PostToolUse")).toBe(true);
  });

  test("unregister removes hook", () => {
    registry.register({ id: "to-remove", event: "PostToolUse", type: "prompt", prompt: "a" });
    expect(registry.unregister("to-remove")).toBe(true);
    expect(registry.list().length).toBe(0);
    expect(registry.unregister("to-remove")).toBe(false);
  });

  test("disabled hooks are excluded from list", () => {
    registry.register({ id: "enabled", event: "PostToolUse", type: "prompt", prompt: "a", enabled: true });
    registry.register({ id: "disabled", event: "PostToolUse", type: "prompt", prompt: "b", enabled: false });

    expect(registry.list().length).toBe(1);
    expect(registry.list()[0].id).toBe("enabled");
  });

  test("execute prompt hook returns inject text", async () => {
    registry.register({
      id: "inject-prompt",
      event: "TaskStart",
      type: "prompt",
      prompt: "Remember to run tests",
    });

    const ctx: HookContext = { event: "TaskStart", timestamp: Date.now() };
    const result = await registry.execute("TaskStart", ctx);
    expect(result.inject).toContain("Remember to run tests");
  });

  test("matcher filters by tool name", async () => {
    registry.register({
      id: "bash-only",
      event: "PostToolUse",
      type: "prompt",
      matcher: "Bash",
      prompt: "check output",
    });

    const bashCtx: HookContext = { event: "PostToolUse", toolName: "Bash", timestamp: Date.now() };
    const editCtx: HookContext = { event: "PostToolUse", toolName: "Edit", timestamp: Date.now() };

    const bashResult = await registry.execute("PostToolUse", bashCtx);
    const editResult = await registry.execute("PostToolUse", editCtx);

    expect(bashResult.inject).toContain("check output");
    expect(editResult.inject).toBeUndefined();
  });

  test("regex matcher works", async () => {
    registry.register({
      id: "edit-write",
      event: "PostToolUse",
      type: "prompt",
      matcher: "Edit|Write",
      prompt: "format code",
    });

    const editCtx: HookContext = { event: "PostToolUse", toolName: "Edit", timestamp: Date.now() };
    const writeCtx: HookContext = { event: "PostToolUse", toolName: "Write", timestamp: Date.now() };
    const bashCtx: HookContext = { event: "PostToolUse", toolName: "Bash", timestamp: Date.now() };

    expect((await registry.execute("PostToolUse", editCtx)).inject).toContain("format code");
    expect((await registry.execute("PostToolUse", writeCtx)).inject).toContain("format code");
    expect((await registry.execute("PostToolUse", bashCtx)).inject).toBeUndefined();
  });

  test("hooks execute in priority order", async () => {
    const order: string[] = [];

    // Use prompt hooks and check inject order
    registry.register({ id: "low", event: "TaskStart", type: "prompt", prompt: "LOW", priority: 200 });
    registry.register({ id: "high", event: "TaskStart", type: "prompt", prompt: "HIGH", priority: 50 });
    registry.register({ id: "mid", event: "TaskStart", type: "prompt", prompt: "MID", priority: 100 });

    const ctx: HookContext = { event: "TaskStart", timestamp: Date.now() };
    const result = await registry.execute("TaskStart", ctx);

    // HIGH should come before MID which comes before LOW
    const inject = result.inject!;
    const highIdx = inject.indexOf("HIGH");
    const midIdx = inject.indexOf("MID");
    const lowIdx = inject.indexOf("LOW");
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  test("mode change hook matches mode value", async () => {
    registry.register({
      id: "plan-mode",
      event: "ModeChange",
      type: "prompt",
      matcher: "plan",
      prompt: "entering plan mode",
    });

    const planCtx: HookContext = { event: "ModeChange", mode: "plan", timestamp: Date.now() };
    const agentCtx: HookContext = { event: "ModeChange", mode: "agent", timestamp: Date.now() };

    expect((await registry.execute("ModeChange", planCtx)).inject).toContain("entering plan mode");
    expect((await registry.execute("ModeChange", agentCtx)).inject).toBeUndefined();
  });
});
