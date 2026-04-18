/**
 * statusFile.ts — Writes ~/.claude-drive/status.json atomically
 * so the Claude Code status line script can read Drive state without HTTP.
 */
import fs from "fs";
import { statusDir, statusFile } from "./paths.js";

export interface OperatorStatsData {
  costUsd: number;
  durationMs: number;
  apiDurationMs: number;
  turns: number;
  taskCount: number;
}

export interface PlanCostData {
  planIndex: number;
  costUsd: number;
  durationMs: number;
  turns: number;
  taskCount: number;
  active: boolean;     // true if this plan period is still running
}

export interface StatusFileData {
  active: boolean;
  subMode: string;
  foregroundOperator: string | null;
  operators: Array<{
    name: string;
    status: string;
    role?: string;
    task: string;
    stats: OperatorStatsData;
  }>;
  totals: OperatorStatsData;
  currentPlan: PlanCostData | null;
  lastCompletedPlan: PlanCostData | null;
  updatedAt: number;
}

export function getStatusFilePath(): string {
  return statusFile();
}

/** Write status.json atomically (write to .tmp, then rename). */
export function writeStatusFile(data: StatusFileData): void {
  try {
    fs.mkdirSync(statusDir(), { recursive: true });
    const target = statusFile();
    const tmp = target + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data), "utf-8");
    fs.renameSync(tmp, target);
  } catch (e) {
    // Non-critical — don't crash the server
    process.stderr.write(`[claude-drive] Failed to write status file: ${e}\n`);
  }
}

/** Delete status.json on shutdown. */
export function deleteStatusFile(): void {
  const target = statusFile();
  try { fs.unlinkSync(target); } catch { /* already gone */ }
  try { fs.unlinkSync(target + ".tmp"); } catch { /* already gone */ }
}
