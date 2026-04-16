/**
 * config.ts — Configuration loader for claude-drive.
 * Priority: CLI flags (set via setFlag) > env vars > ~/.claude-drive/config.json > defaults
 * Replaces vscode.workspace.getConfiguration("cursorDrive.*")
 */
import fs from "fs";
import { atomicWriteJSON } from "./atomicWrite.js";
import { configFile } from "./paths.js";
import { validateConfig, validateConfigValue } from "./configSchema.js";
// NOTE: do NOT import logger — logger imports config; the import cycle would
// unload one of them. Use stderr directly for the failure paths here.

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

  // Logging
  "log.level": "info",

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

/**
 * Encapsulates the two mutable layers (file-backed + runtime flags) that used
 * to be free-floating module-level `let`s. The default singleton is the one
 * exposed via the `setFlag`/`getConfig`/`saveConfig` free functions below.
 */
class ConfigStore {
  private fileConfig: Record<string, unknown> = {};
  private runtimeFlags: Record<string, unknown> = {};

  constructor() {
    this.load();
  }

  load(): void {
    try {
      const p = configFile();
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
        const validated = validateConfig(raw);
        this.fileConfig = validated.parsed;
        if (validated.errors.length > 0) {
          const summary = validated.errors
            .map((e) => `${e.key}=${JSON.stringify(e.value)} (${e.message})`)
            .join("; ");
          process.stderr.write(`[config] Ignoring ${validated.errors.length} invalid value(s): ${summary}\n`);
        }
      } else {
        this.fileConfig = {};
      }
    } catch {
      this.fileConfig = {};
    }
  }

  setFlag(key: string, value: unknown): void {
    this.runtimeFlags[key] = value;
  }

  get<T>(key: string): T {
    if (key in this.runtimeFlags) return this.runtimeFlags[key] as T;

    const envKey = "CLAUDE_DRIVE_" + key.toUpperCase().replace(/\./g, "_");
    if (process.env[envKey] !== undefined) return process.env[envKey] as unknown as T;

    if (key in this.fileConfig) return this.fileConfig[key] as T;
    if (key in DEFAULTS) return DEFAULTS[key] as T;

    return undefined as unknown as T;
  }

  save(key: string, value: unknown): void {
    const v = validateConfigValue(key, value);
    if (!v.ok) {
      process.stderr.write(`[config] Rejecting invalid value for ${key}: ${v.message}\n`);
      return;
    }
    this.load();
    this.fileConfig[key] = v.value;
    try {
      atomicWriteJSON(configFile(), this.fileConfig);
    } catch (e) {
      process.stderr.write(`[config] Failed to save: ${String(e)}\n`);
    }
  }

  /** Test-only: reset both layers. */
  __resetForTests(): void {
    this.fileConfig = {};
    this.runtimeFlags = {};
  }
}

/** The default, process-wide config store. */
const defaultStore = new ConfigStore();

/** Override a config value at runtime (e.g., from CLI flags). */
export function setFlag(key: string, value: unknown): void {
  defaultStore.setFlag(key, value);
}

/** Get a config value by dot-path key (e.g., "tts.backend"). */
export function getConfig<T>(key: string): T {
  return defaultStore.get<T>(key);
}

/** Write a value to the persistent config file. */
export function saveConfig(key: string, value: unknown): void {
  defaultStore.save(key, value);
}

/** Test-only: reload file + clear runtime flags. */
export function __resetConfigForTests(): void {
  defaultStore.__resetForTests();
  defaultStore.load();
}
