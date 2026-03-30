import { jest } from "@jest/globals";
import { AgentOutputEmitter } from "../src/agentOutput.js";
import type { DriveOutputEvent } from "../src/agentOutput.js";

describe("AgentOutputEmitter", () => {
  let emitter: AgentOutputEmitter;

  beforeEach(() => {
    emitter = new AgentOutputEmitter();
    emitter.setRenderMode("tui"); // suppress stdout in tests
  });

  it("getRenderMode defaults to terminal", () => {
    const fresh = new AgentOutputEmitter();
    expect(fresh.getRenderMode()).toBe("terminal");
  });

  it("setRenderMode changes the mode", () => {
    expect(emitter.getRenderMode()).toBe("tui");
    emitter.setRenderMode("terminal");
    expect(emitter.getRenderMode()).toBe("terminal");
  });

  it("emit fires event listeners", () => {
    const handler = jest.fn();
    emitter.on("event", handler);

    const event: DriveOutputEvent = {
      type: "activity",
      agent: "testAgent",
      text: "hello",
    };
    emitter.emit("event", event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("emit returns true when listeners exist", () => {
    emitter.on("event", () => {});
    const event: DriveOutputEvent = {
      type: "activity",
      agent: "op",
      text: "msg",
    };
    expect(emitter.emit("event", event)).toBe(true);
  });

  it("activity event has correct shape", () => {
    const handler = jest.fn();
    emitter.on("event", handler);

    emitter.emit("event", {
      type: "activity",
      agent: "builder",
      text: "compiling",
      timestamp: 12345,
    });

    const received = handler.mock.calls[0][0] as DriveOutputEvent;
    expect(received.type).toBe("activity");
    expect((received as { agent: string }).agent).toBe("builder");
  });

  it("file event carries path and action", () => {
    const handler = jest.fn();
    emitter.on("event", handler);

    emitter.emit("event", {
      type: "file",
      agent: "editor",
      path: "/src/index.ts",
      action: "modified",
    });

    const received = handler.mock.calls[0][0] as DriveOutputEvent;
    expect(received.type).toBe("file");
  });

  it("decision event fires correctly", () => {
    const handler = jest.fn();
    emitter.on("event", handler);

    emitter.emit("event", {
      type: "decision",
      agent: "planner",
      text: "chose approach A",
    });

    const received = handler.mock.calls[0][0] as DriveOutputEvent;
    expect(received.type).toBe("decision");
  });

  it("non-event emissions pass through to EventEmitter", () => {
    const handler = jest.fn();
    emitter.on("custom", handler);
    emitter.emit("custom");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
