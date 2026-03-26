import { OperatorRegistry } from "../src/operatorRegistry.js";
import { createDriveModeManager } from "../src/driveMode.js";
import { createCheckpoint, restoreCheckpoint, listCheckpoints, deleteCheckpoint } from "../src/checkpoint.js";
import fs from "fs";
import path from "path";
import os from "os";

const SESSIONS_DIR = path.join(os.homedir(), ".claude-drive", "sessions");

describe("Checkpoint", () => {
  let registry: OperatorRegistry;
  let driveMode: ReturnType<typeof createDriveModeManager>;
  const testSessionId = `test-session-${Date.now()}`;

  beforeEach(() => {
    registry = new OperatorRegistry();
    driveMode = createDriveModeManager();
  });

  afterEach(() => {
    // Clean up test checkpoint files
    const cpDir = path.join(SESSIONS_DIR, testSessionId, "checkpoints");
    try {
      if (fs.existsSync(cpDir)) {
        for (const f of fs.readdirSync(cpDir)) {
          fs.unlinkSync(path.join(cpDir, f));
        }
        fs.rmdirSync(cpDir);
        fs.rmdirSync(path.join(SESSIONS_DIR, testSessionId));
      }
    } catch {
      // ignore
    }
    driveMode.dispose();
  });

  test("create checkpoint captures state", () => {
    registry.spawn("Alice", "build feature");
    registry.spawn("Bob", "review code");
    driveMode.setActive(true);
    driveMode.setSubMode("plan");

    const cp = createCheckpoint(testSessionId, registry, driveMode, []);

    expect(cp.id).toBeDefined();
    expect(cp.sessionId).toBe(testSessionId);
    expect(cp.operators.length).toBe(2);
    expect(cp.driveMode.active).toBe(true);
    expect(cp.driveMode.subMode).toBe("plan");
  });

  test("list checkpoints returns created checkpoints", () => {
    registry.spawn("Alice", "task 1");

    createCheckpoint(testSessionId, registry, driveMode, [], "cp1");
    createCheckpoint(testSessionId, registry, driveMode, [], "cp2");

    const checkpoints = listCheckpoints(testSessionId);
    expect(checkpoints.length).toBe(2);
  });

  test("delete checkpoint removes it", () => {
    registry.spawn("Alice", "task");
    const cp = createCheckpoint(testSessionId, registry, driveMode, [], "doomed");

    expect(deleteCheckpoint(cp.id)).toBe(true);
    expect(listCheckpoints(testSessionId).length).toBe(0);
    expect(deleteCheckpoint(cp.id)).toBe(false);
  });

  test("restore checkpoint recreates operators", () => {
    registry.spawn("Alice", "build feature");
    registry.spawn("Bob", "review code");
    driveMode.setActive(true);
    driveMode.setSubMode("plan");

    const cp = createCheckpoint(testSessionId, registry, driveMode, []);

    // Dismiss all operators
    for (const op of registry.list()) {
      registry.dismiss(op.id);
    }
    driveMode.setSubMode("agent");

    // Restore
    const result = restoreCheckpoint(cp.id, registry, driveMode);
    expect(result.ok).toBe(true);

    // Check operators were restored
    const active = registry.getActive();
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(driveMode.subMode).toBe("plan");
  });
});
