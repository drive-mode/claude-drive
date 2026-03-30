/**
 * sessionStore.ts — JSON snapshot store for operator sessions.
 * Persists to ~/.claude-drive/sessions/<id>.json
 */
import fs from "fs";
import path from "path";
import os from "os";
import type { SerializableOperator } from "./operatorRegistry.js";
import type { DriveOutputEvent } from "./agentOutput.js";
import { atomicWriteJSON } from "./atomicWrite.js";

const SESSIONS_DIR = path.join(os.homedir(), ".claude-drive", "sessions");

export interface SessionSnapshot {
  id: string;
  createdAt: number;
  name?: string;
  driveMode: { active: boolean; subMode: string };
  operators: SerializableOperator[];
  activityLog: DriveOutputEvent[];
}

function ensureDir(): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function saveSession(snapshot: SessionSnapshot): void {
  ensureDir();
  const filePath = path.join(SESSIONS_DIR, `${snapshot.id}.json`);
  atomicWriteJSON(filePath, snapshot);
}

export function loadSession(id: string): SessionSnapshot | undefined {
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as SessionSnapshot;
  } catch {
    return undefined;
  }
}

export function listSessions(): SessionSnapshot[] {
  ensureDir();
  try {
    return fs.readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8")) as SessionSnapshot;
        } catch {
          return null;
        }
      })
      .filter((s): s is SessionSnapshot => s !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function deleteSession(id: string): boolean {
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  try {
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}
