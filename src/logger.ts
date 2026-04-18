/**
 * logger.ts — Leveled logger that library code uses instead of `console.*`.
 *
 * Design constraints:
 *
 *   - Output always goes to `stderr`, keeping `stdout` available for data
 *     pipelines (CLI `--json`, MCP tool responses, etc.).
 *   - Level is resolved at call-time from `log.level` config (default `info`),
 *     so tests can toggle it without re-importing the module.
 *   - No new runtime dependency.
 *   - CLI user-facing output (`console.log`) stays as-is; only library code
 *     migrates to this logger.
 */
import { getConfig } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function resolveLevel(): LogLevel {
  const configured = (getConfig<LogLevel | undefined>("log.level") ?? "info") as LogLevel;
  return LEVEL_ORDER[configured] !== undefined ? configured : "info";
}

function shouldLog(target: LogLevel): boolean {
  return LEVEL_ORDER[target] >= LEVEL_ORDER[resolveLevel()];
}

function emit(target: LogLevel, args: unknown[]): void {
  if (!shouldLog(target)) return;
  const line = args
    .map((a) => (typeof a === "string" ? a : formatValue(a)))
    .join(" ");
  // Always to stderr — never pollute stdout.
  process.stderr.write(line + "\n");
}

function formatValue(v: unknown): string {
  if (v instanceof Error) {
    return v.stack ?? `${v.name}: ${v.message}`;
  }
  try {
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

export const logger = {
  debug: (...args: unknown[]): void => emit("debug", args),
  info: (...args: unknown[]): void => emit("info", args),
  warn: (...args: unknown[]): void => emit("warn", args),
  error: (...args: unknown[]): void => emit("error", args),
  /** Return true if the given level would be emitted. Useful for expensive formatting. */
  isEnabled: (level: LogLevel): boolean => shouldLog(level),
};

export type Logger = typeof logger;
