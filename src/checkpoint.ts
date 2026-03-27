/**
 * checkpoint.ts — Checkpoint creation, restore, and fork management for claude-drive.
 * Extends session management with point-in-time snapshots and session forking.
 */
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import type { OperatorRegistry, OperatorContext } from "./operatorRegistry.js";
import type { DriveModeManager } from "./driveMode.js";
import type { MemoryEntry } from "./memoryStore.js";
import { exportAll as exportMemory, importBulk as importMemory } from "./memoryManager.js";
import type { DriveOutputEvent } from "./agentOutput.js";
import { getConfig } from "./config.js";
import { atomicWriteJSON } from "./atomicWrite.js";

const SESSIONS_DIR = path.join(os.homedir(), ".claude-drive", "sessions");

export interface Checkpoint {
  id: string;
  sessionId: string;
  name?: string;
  description?: string;
  createdAt: number;
  operators: OperatorContext[];
  driveMode: { active: boolean; subMode: string };
  memory: MemoryEntry[];
  activityLog: DriveOutputEvent[];
  metadata: Record<string, unknown>;
}

function checkpointDir(sessionId: string): string {
  return path.join(SESSIONS_DIR, sessionId, "checkpoints");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Create a checkpoint of the current state. */
export function createCheckpoint(
  sessionId: string,
  registry: OperatorRegistry,
  driveMode: DriveModeManager,
  activityLog: DriveOutputEvent[],
  name?: string,
  description?: string,
  metadata?: Record<string, unknown>
): Checkpoint {
  const cp: Checkpoint = {
    id: `cp-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    sessionId,
    name,
    description,
    createdAt: Date.now(),
    operators: registry.list().map((o) => ({ ...o })),
    driveMode: { active: driveMode.active, subMode: driveMode.subMode },
    memory: exportMemory(),
    activityLog: [...activityLog],
    metadata: metadata ?? {},
  };

  const dir = checkpointDir(sessionId);
  ensureDir(dir);
  atomicWriteJSON(path.join(dir, `${cp.id}.json`), cp);

  // Enforce max checkpoints
  const maxCheckpoints = getConfig<number>("sessions.maxCheckpoints") ?? 20;
  pruneCheckpoints(sessionId, maxCheckpoints);

  return cp;
}

/** Restore state from a checkpoint. */
export function restoreCheckpoint(
  checkpointId: string,
  registry: OperatorRegistry,
  driveMode: DriveModeManager
): { ok: boolean; activityLog?: DriveOutputEvent[] } {
  const cp = findCheckpoint(checkpointId);
  if (!cp) return { ok: false };

  // Restore drive mode
  driveMode.setActive(cp.driveMode.active);
  driveMode.setSubMode(cp.driveMode.subMode as never);

  // Restore operators: dismiss all current, then spawn from snapshot
  for (const op of registry.list()) {
    registry.dismiss(op.id);
  }
  for (const op of cp.operators) {
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

  // Restore memory
  importMemory(cp.memory);

  return { ok: true, activityLog: cp.activityLog };
}

/** List checkpoints for a session (or search all sessions). */
export function listCheckpoints(sessionId?: string): Checkpoint[] {
  const results: Checkpoint[] = [];

  if (sessionId) {
    results.push(...readCheckpointsFromDir(checkpointDir(sessionId)));
  } else {
    // Search all session directories
    try {
      if (!fs.existsSync(SESSIONS_DIR)) return [];
      const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          results.push(...readCheckpointsFromDir(checkpointDir(entry.name)));
        }
      }
    } catch {
      // Ignore
    }
  }

  return results.sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete a checkpoint. */
export function deleteCheckpoint(checkpointId: string): boolean {
  const cp = findCheckpoint(checkpointId);
  if (!cp) return false;
  const filePath = path.join(checkpointDir(cp.sessionId), `${checkpointId}.json`);
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Fork a session from a checkpoint (or current state). Creates a new session ID. */
export function forkSession(
  sourceSessionId: string,
  registry: OperatorRegistry,
  driveMode: DriveModeManager,
  activityLog: DriveOutputEvent[],
  checkpointId?: string,
  newSessionName?: string
): { newSessionId: string; checkpoint: Checkpoint } {
  const newSessionId = `session-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  // Create a checkpoint of the fork point
  const cp = checkpointId
    ? findCheckpoint(checkpointId)
    : createCheckpoint(sourceSessionId, registry, driveMode, activityLog, `fork-point-for-${newSessionId}`);

  if (!cp) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  // Create the fork checkpoint in the new session directory
  const forkCp: Checkpoint = {
    ...cp,
    id: `cp-fork-${Date.now()}`,
    sessionId: newSessionId,
    name: newSessionName ?? `Fork of ${sourceSessionId}`,
    metadata: {
      ...cp.metadata,
      forkedFrom: sourceSessionId,
      forkedCheckpoint: cp.id,
    },
  };

  const dir = checkpointDir(newSessionId);
  ensureDir(dir);
  atomicWriteJSON(path.join(dir, `${forkCp.id}.json`), forkCp);

  return { newSessionId, checkpoint: forkCp };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function readCheckpointsFromDir(dir: string): Checkpoint[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as Checkpoint;
        } catch {
          return null;
        }
      })
      .filter((c): c is Checkpoint => c !== null);
  } catch {
    return [];
  }
}

function findCheckpoint(checkpointId: string): Checkpoint | undefined {
  // Search all sessions for this checkpoint
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return undefined;
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const cpFile = path.join(checkpointDir(entry.name), `${checkpointId}.json`);
      if (fs.existsSync(cpFile)) {
        return JSON.parse(fs.readFileSync(cpFile, "utf-8")) as Checkpoint;
      }
    }
  } catch {
    // Ignore
  }
  return undefined;
}

function pruneCheckpoints(sessionId: string, maxCount: number): void {
  const dir = checkpointDir(sessionId);
  const checkpoints = readCheckpointsFromDir(dir)
    .sort((a, b) => a.createdAt - b.createdAt);

  while (checkpoints.length > maxCount) {
    const oldest = checkpoints.shift()!;
    try {
      fs.unlinkSync(path.join(dir, `${oldest.id}.json`));
    } catch {
      // Ignore
    }
  }
}
