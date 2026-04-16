/**
 * progressFile.ts — Background operator progress snapshot writer/reader.
 *
 * Writes per-operator progress under `~/.claude-drive/subagents/<operatorId>/`:
 *   - `events.jsonl`  — append-only stream of events (task_started, task_progress, result, error)
 *   - `last.json`     — atomic snapshot of the most recent event (for quick polling)
 *
 * All functions accept an optional `baseDir` for testability.
 */
import fs from "fs";
import path from "path";
import { atomicWriteJSON } from "./atomicWrite.js";
import { subagentsBaseDir } from "./paths.js";

export interface ProgressEvent {
  /** Event kind. */
  type: "task_started" | "task_progress" | "task_updated" | "result" | "error" | "status";
  /** Monotonic wall-clock timestamp. */
  timestamp: number;
  /** Operator id — always stamped on write. */
  operatorId: string;
  /** Free-form payload from the SDK event. */
  [key: string]: unknown;
}

export function defaultBaseDir(): string {
  return subagentsBaseDir();
}

export function progressDir(operatorId: string, baseDir?: string): string {
  return path.join(baseDir ?? defaultBaseDir(), operatorId);
}

export function ensureProgressDir(operatorId: string, baseDir?: string): string {
  const dir = progressDir(operatorId, baseDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeProgressEvent(
  operatorId: string,
  event: Omit<ProgressEvent, "operatorId" | "timestamp"> & { timestamp?: number },
  baseDir?: string,
): ProgressEvent {
  const dir = ensureProgressDir(operatorId, baseDir);
  const stamped: ProgressEvent = {
    ...(event as ProgressEvent),
    operatorId,
    timestamp: event.timestamp ?? Date.now(),
  };

  // Append line-oriented event log (safe for single-writer per operator).
  try {
    fs.appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify(stamped) + "\n", "utf-8");
  } catch (e) {
    console.error(`[progressFile] append failed for ${operatorId}:`, e);
  }

  // Atomic snapshot.
  try {
    atomicWriteJSON(path.join(dir, "last.json"), stamped);
  } catch (e) {
    console.error(`[progressFile] snapshot failed for ${operatorId}:`, e);
  }

  return stamped;
}

export interface ProgressSnapshot {
  last: ProgressEvent | undefined;
  events: ProgressEvent[];
}

export function readProgressSnapshot(operatorId: string, baseDir?: string): ProgressSnapshot {
  const dir = progressDir(operatorId, baseDir);
  let last: ProgressEvent | undefined;
  let events: ProgressEvent[] = [];

  try {
    const raw = fs.readFileSync(path.join(dir, "last.json"), "utf-8");
    last = JSON.parse(raw) as ProgressEvent;
  } catch {
    last = undefined;
  }

  try {
    const raw = fs.readFileSync(path.join(dir, "events.jsonl"), "utf-8");
    events = raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as ProgressEvent;
        } catch {
          return undefined;
        }
      })
      .filter((e): e is ProgressEvent => e !== undefined);
  } catch {
    events = [];
  }

  return { last, events };
}

/** Remove an operator's progress directory (safe no-op if missing). */
export function clearProgress(operatorId: string, baseDir?: string): void {
  const dir = progressDir(operatorId, baseDir);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
