/**
 * sessionManager.ts — High-level session create/resume.
 */
import type { OperatorRegistry } from "./operatorRegistry.js";
import { toSerializable } from "./operatorRegistry.js";
import type { DriveModeManager, DriveSubMode } from "./driveMode.js";
import { saveSession, loadSession, listSessions as listStoredSessions } from "./sessionStore.js";
import type { SessionSnapshot } from "./sessionStore.js";

const MAX_LOG = 200;

/**
 * Rolling activity log. The public `trackEvent` pushes onto the default
 * instance; tests can call `__resetActivityLog()` for isolation.
 */
class ActivityLog {
  private events: import("./agentOutput.js").DriveOutputEvent[] = [];
  push(ev: import("./agentOutput.js").DriveOutputEvent): void {
    this.events.push(ev);
    if (this.events.length > MAX_LOG) this.events.shift();
  }
  snapshot(): import("./agentOutput.js").DriveOutputEvent[] {
    return [...this.events];
  }
  replace(events: import("./agentOutput.js").DriveOutputEvent[]): void {
    this.events = [...events];
  }
  clear(): void {
    this.events = [];
  }
}

const defaultLog = new ActivityLog();

export function trackEvent(event: import("./agentOutput.js").DriveOutputEvent): void {
  defaultLog.push(event);
}

/** Test-only: wipe the activity log. */
export function __resetActivityLog(): void {
  defaultLog.clear();
}

export function createSession(registry: OperatorRegistry, driveMode: DriveModeManager, name?: string): string {
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const snapshot: SessionSnapshot = {
    id,
    createdAt: Date.now(),
    name,
    driveMode: { active: driveMode.active, subMode: driveMode.subMode },
    operators: registry.list().map(toSerializable),
    activityLog: defaultLog.snapshot(),
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

  defaultLog.replace(snapshot.activityLog);
  return true;
}

export function listSessions(): SessionSnapshot[] {
  return listStoredSessions();
}
