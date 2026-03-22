/**
 * statusFile.ts — Writes ~/.claude-drive/status.json atomically
 * so the Claude Code status line script can read Drive state without HTTP.
 */
import fs from "fs";
import path from "path";
import os from "os";

export interface StatusFileData {
  active: boolean;
  subMode: string;
  foregroundOperator: string | null;
  operators: Array<{
    name: string;
    status: string;
    role?: string;
    task: string;
  }>;
  updatedAt: number;
}

const STATUS_DIR = path.join(os.homedir(), ".claude-drive");
const STATUS_FILE = path.join(STATUS_DIR, "status.json");

export function getStatusFilePath(): string {
  return STATUS_FILE;
}

/** Write status.json atomically (write to .tmp, then rename). */
export function writeStatusFile(data: StatusFileData): void {
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    const tmp = STATUS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data), "utf-8");
    fs.renameSync(tmp, STATUS_FILE);
  } catch (e) {
    // Non-critical — don't crash the server
    process.stderr.write(`[claude-drive] Failed to write status file: ${e}\n`);
  }
}

/** Delete status.json on shutdown. */
export function deleteStatusFile(): void {
  try {
    fs.unlinkSync(STATUS_FILE);
  } catch {
    /* already gone */
  }
  try {
    fs.unlinkSync(STATUS_FILE + ".tmp");
  } catch {
    /* already gone */
  }
}
