/**
 * tests/operatorAwait.test.ts — verifies the await-semantic pieces:
 * registry.setRunPromise, registry.markStatus, and readProgressSnapshot after
 * a completed background run.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { OperatorRegistry } from "../src/operatorRegistry.js";
import { writeProgressEvent, readProgressSnapshot } from "../src/progressFile.js";

function tmpBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cd-await-"));
}

describe("operator await semantics", () => {
  test("await on runPromise resolves when background task completes", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("bg1");
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    reg.setRunPromise(op.id, promise);
    expect(op.runPromise).toBeDefined();

    // Simulate the runOperator flow marking status on completion.
    setTimeout(() => {
      reg.markStatus(op.id, "completed");
      resolve();
    }, 10);

    await op.runPromise;
    expect(op.status).toBe("completed");
  });

  test("progress snapshot records the last event after a run", () => {
    const base = tmpBase();
    const reg = new OperatorRegistry();
    const op = reg.spawn("bg2");
    writeProgressEvent(op.id, { type: "task_started", description: "boot" }, base);
    writeProgressEvent(op.id, {
      type: "result",
      stats: { totalCostUsd: 0.02, durationMs: 10, numTurns: 1 },
    }, base);
    const snap = readProgressSnapshot(op.id, base);
    expect(snap.last?.type).toBe("result");
    expect(snap.events).toHaveLength(2);
  });

  test("timeout path reports after race without resolution", async () => {
    const reg = new OperatorRegistry();
    const op = reg.spawn("bg3");
    reg.setRunPromise(op.id, new Promise(() => { /* never resolves */ }));

    const outcome = await Promise.race([
      op.runPromise!.then(() => "done"),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 30)),
    ]);
    expect(outcome).toBe("timeout");
  });
});
