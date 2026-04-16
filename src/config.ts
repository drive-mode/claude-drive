/**
 * config.ts — Configuration loader for claude-drive.
 * Priority: CLI flags (set via setFlag) > env vars > ~/.claude-drive/config.json > defaults
 * Replaces vscode.workspace.getConfiguration("cursorDrive.*")
 */
import fs from "fs";
import path from "path";
import os from "os";
import { atomicWriteJSON } from "./atomicWrite.js";

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
  "operators.maxDepth": 3,
  "operators.namePool": [],  // empty = numbered "Operator 1", "Operator 2", …; set custom names to override
  "operators.defaultPermissionPreset": "standard",

  // Operator runtime (Agent SDK query options)
  "operator.preWarm": true,
  "operator.taskBudget": undefined,
  "operator.agentProgressSummaries": true,
  "operator.defaultEffort": undefined,
  "operator.maxBudgetUsd": undefined,
  "operator.awaitTimeoutMs": 300000,

  // Best-of-N
  "bestOfN.enabled": true,
  "bestOfN.maxCount": 4,

  // Agent definitions
  "agents.directory": "~/.claude-drive/agents",

  // Memory (SDK event import)
  "memory.syncFromSdk": true,

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

  // Memory
  "memory.maxEntries": 500,
  "memory.maxPerOperator": 100,
  "memory.defaultConfidence": 0.8,
  "memory.decayEnabled": true,
  "memory.decayHalfLifeHours": 168,  // 1 week

  // Hooks
  "hooks.enabled": true,
  "hooks.directory": "~/.claude-drive/hooks",
  "hooks.definitions": [],

  // Skills
  "skills.directory": "~/.claude-drive/skills",
  "skills.enabled": true,

  // Sessions (enhanced)
  "sessions.maxCheckpoints": 20,
  "sessions.autoCheckpoint": false,
  "sessions.autoCheckpointIntervalMs": 300000,  // 5 minutes

  // Auto-Dream
  "dream.enabled": true,
  "dream.intervalMs": 900000,        // 15 minutes
  "dream.minEntries": 10,
  "dream.pruneThreshold": 0.2,
  "dream.mergeThreshold": 0.7,
  "dream.maxAgeMs": 604800000,       // 7 days
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
    atomicWriteJSON(CONFIG_FILE, fileConfig);
  } catch (e) {
    console.error("[config] Failed to save:", e);
  }
}
