/**
 * sessionManager.ts — High-level session create/resume.
 */
import type { OperatorRegistry } from "./operatorRegistry.js";
import type { DriveModeManager, DriveSubMode } from "./driveMode.js";
import { saveSession, loadSession, listSessions as listStoredSessions } from "./sessionStore.js";
import type { SessionSnapshot } from "./sessionStore.js";

let activityLog: import("./agentOutput.js").DriveOutputEvent[] = [];
const MAX_LOG = 200;

export function trackEvent(event: import("./agentOutput.js").DriveOutputEvent): void {
  activityLog.push(event);
  if (activityLog.length > MAX_LOG) activityLog.shift();
}

export function createSession(registry: OperatorRegistry, driveMode: DriveModeManager, name?: string): string {
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const snapshot: SessionSnapshot = {
    id,
    createdAt: Date.now(),
    name,
    driveMode: { active: driveMode.active, subMode: driveMode.subMode },
    operators: registry.list(),
    activityLog: [...activityLog],
  };
  saveSession(snapshot);
  return id;
}

export function resumeSession(id: string, registry: OperatorRegistry, driveMode: DriveModeManager): boolean {
  const snapshot = loadSession(id);
  if (!snapshot) return false;

  driveMode.setActive(snapshot.driveMode.active);
  driveMode.setSubMode(snapshot.driveMode.subMode as DriveSubMode);

  for (const op of snapshot.operators) {
    if (op.status === "completed" || op.status === "merged") continue;
    try {
      registry.spawn(op.name, op.task, {
        role: op.role,
        preset: op.permissionPreset,
        parentId: op.parentId,
        depth: op.depth,
      });
    } catch {
      // Skip operators that fail to restore
    }
  }

  activityLog = [...snapshot.activityLog];
  return true;
}

export function listSessions(): SessionSnapshot[] {
  return listStoredSessions();
}
