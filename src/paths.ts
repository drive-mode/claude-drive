/**
 * paths.ts — Single source of truth for every on-disk location claude-drive
 * reads or writes.
 *
 * All persistent state lives under one "home" directory. The directory is
 * resolved in this priority order:
 *
 *   1. `CLAUDE_DRIVE_HOME` env var (absolute or `~`-prefixed).
 *   2. `$HOME/.claude-drive` (default).
 *
 * No other module should compute `os.homedir() + ".claude-drive"` directly;
 * importing from here keeps the mapping testable and swappable.
 */
import os from "os";
import path from "path";

/** Returns the absolute path to the claude-drive home directory. */
export function home(): string {
  const env = process.env.CLAUDE_DRIVE_HOME;
  if (env && env.trim().length > 0) {
    const trimmed = env.trim();
    if (trimmed === "~") return os.homedir();
    if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
    return trimmed;
  }
  return path.join(os.homedir(), ".claude-drive");
}

export function configFile(): string {
  return path.join(home(), "config.json");
}

export function portFile(): string {
  return path.join(home(), "port");
}

export function statusFile(): string {
  return path.join(home(), "status.json");
}

export function statusDir(): string {
  return home();
}

export function skillsDir(): string {
  return path.join(home(), "skills");
}

export function agentsDir(): string {
  return path.join(home(), "agents");
}

export function hooksDir(): string {
  return path.join(home(), "hooks");
}

export function sessionsDir(): string {
  return path.join(home(), "sessions");
}

export function subagentsBaseDir(): string {
  return path.join(home(), "subagents");
}

export function subagentDir(operatorId: string): string {
  return path.join(subagentsBaseDir(), operatorId);
}

export function statuslineScriptPath(): string {
  return path.join(home(), "statusline.sh");
}

/**
 * Expand a tilde-prefixed user path ("~" or "~/foo") to an absolute path
 * rooted at the OS home directory. Useful for config values that may contain
 * `~/.claude-drive/...` patterns.
 */
export function expandUserHome(input: string): string {
  if (!input) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}
