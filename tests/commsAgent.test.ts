import { jest } from "@jest/globals";
import { CommsAgent } from "../src/commsAgent.js";
import type { CommsEvent } from "../src/commsAgent.js";

function makeEvent(
  type: CommsEvent["type"] = "progress",
  operatorName = "testOp",
  message = "did something"
): CommsEvent {
  return { type, operatorName, message, timestamp: Date.now() };
}

describe("CommsAgent", () => {
  let agent: CommsAgent;

  beforeEach(() => {
    agent = new CommsAgent();
  });

  afterEach(() => {
    agent.dispose();
  });

  it("pending starts at 0", () => {
    expect(agent.pending).toBe(0);
  });

  it("push increments pending", () => {
    agent.push(makeEvent());
    expect(agent.pending).toBe(1);
    agent.push(makeEvent());
    expect(agent.pending).toBe(2);
  });

  it("flush returns summary string and resets pending to 0", async () => {
    agent.push(makeEvent("completion", "builder", "finished task"));
    expect(agent.pending).toBe(1);

    const summary = await agent.flush();
    expect(typeof summary).toBe("string");
    expect(summary).not.toBeNull();
    expect(agent.pending).toBe(0);
  });

  it("flush on empty queue returns null", async () => {
    const result = await agent.flush();
    expect(result).toBeNull();
  });

  it("onFlush handler gets called on flush", async () => {
    const handler = jest.fn();
    agent.onFlush(handler);
    agent.push(makeEvent("completion", "op1", "done"));

    await agent.flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(typeof handler.mock.calls[0][0]).toBe("string");
  });

  it("dispose clears queue", () => {
    agent.push(makeEvent());
    agent.push(makeEvent());
    expect(agent.pending).toBe(2);

    agent.dispose();
    expect(agent.pending).toBe(0);
  });

  it("progress convenience method increments pending", () => {
    agent.progress("op1", "working on it");
    expect(agent.pending).toBe(1);
  });

  it("completion convenience method increments pending", () => {
    agent.completion("op1", "finished");
    expect(agent.pending).toBe(1);
  });

  it("error convenience method increments pending", () => {
    agent.error("op1", "something broke");
    expect(agent.pending).toBe(1);
  });

  it("flush formats single event as 'operator type: message'", async () => {
    agent.push(makeEvent("completion", "builder", "built the widget"));
    const summary = await agent.flush();
    expect(summary).toContain("builder");
    expect(summary).toContain("built the widget");
  });

  it("flush formats multiple events grouped by operator", async () => {
    agent.push(makeEvent("progress", "alpha", "step 1"));
    agent.push(makeEvent("completion", "alpha", "done"));
    agent.push(makeEvent("error", "beta", "oops"));
    const summary = await agent.flush();
    expect(summary).toContain("alpha");
    expect(summary).toContain("beta");
  });
});
