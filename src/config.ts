/**
 * config.ts — Configuration loader for claude-drive.
 * Priority: CLI flags (set via setFlag) > env vars > ~/.claude-drive/config.json > defaults
 * Replaces vscode.workspace.getConfiguration("cursorDrive.*")
 */
import fs from "fs";
import path from "path";
import os from "os";
import { validateConfig, type ClaudeDriveConfig } from "./configSchema.js";

const CONFIG_FILE = path.join(os.homedir(), ".claude-drive", "config.json");

// ── Flat ↔ nested helpers ───────────────────────────────────────────────────

/** Flatten a nested object into dot-path keys: { a: { b: 1 } } → { "a.b": 1 } */
function flatten(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      flatten(v as Record<string, unknown>, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

/** Unflatten dot-path keys into a nested object: { "a.b": 1 } → { a: { b: 1 } } */
function unflatten(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in cur) || typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

// ── Schema-derived defaults ─────────────────────────────────────────────────

/** Validated defaults from the Zod schema (flattened to dot-path keys). */
const DEFAULTS: Record<string, unknown> = flatten(
  validateConfig({}) as unknown as Record<string, unknown>,
);

let fileConfig: Record<string, unknown> = {};
let runtimeFlags: Record<string, unknown> = {};

function loadFile(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      // Validate: supports both flat ("tts.enabled") and nested ({ tts: { enabled } }) formats.
      const hasDotKeys = Object.keys(raw).some((k) => k.includes("."));
      const nested = hasDotKeys ? unflatten(raw) : raw;
      const validated = validateConfig(nested) as unknown as Record<string, unknown>;
      fileConfig = flatten(validated);
    }
  } catch {
    fileConfig = {};
  }
}

loadFile();

/** Override a config value at runtime (e.g., from CLI flags). */
export function setFlag(key: string, value: unknown): void {
  runtimeFlags[key] = value;
}

/** Get a config value by dot-path key (e.g., "tts.backend"). */
export function getConfig<T>(key: string): T {
  if (key in runtimeFlags) return runtimeFlags[key] as T;

  // Check env var: "tts.backend" → "CLAUDE_DRIVE_TTS_BACKEND"
  const envKey = "CLAUDE_DRIVE_" + key.toUpperCase().replace(/\./g, "_");
  if (process.env[envKey] !== undefined) return process.env[envKey] as unknown as T;

  if (key in fileConfig) return fileConfig[key] as T;
  if (key in DEFAULTS) return DEFAULTS[key] as T;

  return undefined as unknown as T;
}

/** Write a value to the persistent config file. */
export function saveConfig(key: string, value: unknown): void {
  loadFile();
  fileConfig[key] = value;
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(fileConfig, null, 2), "utf-8");
  } catch (e) {
    console.error("[config] Failed to save:", e);
  }
}
