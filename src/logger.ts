/**
 * logger.ts — Structured JSON logging with file rotation for claude-drive.
 * Writes to ~/.claude-drive/logs/ with date-based filenames, size-based rotation,
 * and automatic cleanup of old rotated files.
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

const LOG_DIR = path.join(homedir(), ".claude-drive", "logs");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB per file
const MAX_LOG_FILES = 5;

export type LogLevel = "debug" | "info" | "warn" | "error";

let logStream: fs.WriteStream | null = null;
let currentLogPath: string | null = null;

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogPath(): string {
  return path.join(LOG_DIR, `claude-drive-${new Date().toISOString().slice(0, 10)}.log`);
}

function rotateIfNeeded(): void {
  if (!currentLogPath) return;
  try {
    const stat = fs.statSync(currentLogPath);
    if (stat.size > MAX_LOG_SIZE) {
      if (logStream) {
        logStream.end();
        logStream = null;
      }
      for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
        const from = `${currentLogPath}.${i}`;
        const to = `${currentLogPath}.${i + 1}`;
        try { fs.renameSync(from, to); } catch { /* missing file, skip */ }
      }
      try { fs.renameSync(currentLogPath, `${currentLogPath}.1`); } catch { /* skip */ }
    }
  } catch { /* stat failed — file may not exist yet */ }
}

function getStream(): fs.WriteStream {
  const logPath = getLogPath();
  if (logStream && currentLogPath === logPath) return logStream;
  if (logStream) logStream.end();
  ensureLogDir();
  rotateIfNeeded();
  currentLogPath = logPath;
  logStream = fs.createWriteStream(logPath, { flags: "a" });
  return logStream;
}

/** Write a structured JSON log line to the daily log file. */
export function log(
  level: LogLevel,
  module: string,
  message: string,
  data?: unknown,
): void {
  const timestamp = new Date().toISOString();
  const entry: Record<string, unknown> = { timestamp, level, module, message };
  if (data !== undefined) entry.data = data;
  const line = JSON.stringify(entry);
  getStream().write(line + "\n");
}

/** Flush and close the current log stream. Call on process exit. */
export function closeLogger(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}
