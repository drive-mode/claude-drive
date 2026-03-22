/**
 * config.ts — Configuration loader for claude-drive.
 * Priority: CLI flags (set via setFlag) > env vars > ~/.claude-drive/config.json > defaults
 * Replaces vscode.workspace.getConfiguration("cursorDrive.*")
 */
import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_FILE = path.join(os.homedir(), ".claude-drive", "config.json");

// Defaults mirror cursorDrive.* settings schema
const DEFAULTS: Record<string, unknown> = {
  // TTS
  "tts.enabled": true,
  "tts.backend": "edgeTts",       // "edgeTts" | "piper" | "say"
  "tts.voice": undefined,
  "tts.speed": 1.0,
  "tts.volume": 0.8,
  "tts.maxSpokenSentences": 3,
  "tts.interruptOnInput": true,
  "tts.piperBinaryPath": undefined,
  "tts.piperModelPath": undefined,

  // Operators
  "operators.maxConcurrent": 3,
  "operators.maxSubagents": 2,
  "operators.namePool": ["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot"],
  "operators.defaultPermissionPreset": "standard",

  // MCP server
  "mcp.port": 7891,
  "mcp.portRange": 5,
  "mcp.appsEnabled": false,

  // Agent screen / output
  "agentScreen.mode": "terminal",   // "terminal" | "web"
  "agentScreen.webPort": 7892,

  // Drive
  "drive.defaultMode": "agent",
  "drive.confirmGates": true,

  // Voice
  "voice.enabled": false,
  "voice.wakeWord": "hey drive",
  "voice.sleepWord": "go to sleep",
  "voice.whisperPath": undefined,

  // Privacy
  "privacy.persistTranscripts": false,

  // Approval gates
  "approvalGates.enabled": true,
  "approvalGates.blockPatterns": [],
  "approvalGates.warnPatterns": [],
  "approvalGates.logPatterns": [],

  // Status line
  "statusLine.enabled": true,
  "statusLine.padding": 2,
  "statusLine.showModel": true,
  "statusLine.showContext": true,
  "statusLine.showCost": true,
  "statusLine.showDriveState": true,
  "statusLine.showOperatorTask": true,
  "statusLine.maxTaskLength": 40,

  // Router
  "router.llmEnabled": false,
};

let fileConfig: Record<string, unknown> = {};
let runtimeFlags: Record<string, unknown> = {};

function loadFile(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
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
