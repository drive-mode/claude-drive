/**
 * configSchema.ts — Zod schemas for claude-drive config values.
 *
 * Design:
 *
 *   - One schema per logical group. Top-level `ConfigSchemas` keeps the key→schema
 *     map so `validateConfigValue(key, value)` can return a parsed, typed result
 *     without forcing the caller to know the schema name.
 *   - Unknown keys pass through unchanged (config schema is additive; plugin
 *     extensions may introduce new keys).
 *   - `validateConfig(raw)` returns a `{ valid, errors }` record so callers can
 *     log once on load and continue with the best-effort parsed values.
 */
import { z } from "zod";

const logLevel = z.enum(["debug", "info", "warn", "error", "silent"]);
const effortLevel = z.enum(["low", "medium", "high", "xhigh", "max"]);
const preset = z.enum(["readonly", "standard", "full"]);
const ttsBackend = z.enum(["edgeTts", "piper", "say"]);
const agentScreenMode = z.enum(["terminal", "web"]);
const driveMode = z.enum(["plan", "agent", "ask", "debug", "off"]);

/**
 * Key → zod schema for every known config key. Values kept optional because
 * absence means "use default"; validation applies only to explicitly-set values.
 */
export const ConfigSchemas: Record<string, z.ZodTypeAny> = {
  // TTS
  "tts.enabled": z.boolean(),
  "tts.backend": ttsBackend,
  "tts.voice": z.string().optional(),
  "tts.speed": z.number().positive(),
  "tts.volume": z.number().min(0).max(1),
  "tts.maxSpokenSentences": z.number().int().nonnegative(),
  "tts.interruptOnInput": z.boolean(),
  "tts.piperBinaryPath": z.string().optional(),
  "tts.piperModelPath": z.string().optional(),

  // Operators
  "operators.maxConcurrent": z.number().int().positive(),
  "operators.maxSubagents": z.number().int().nonnegative(),
  "operators.maxDepth": z.number().int().nonnegative(),
  "operators.namePool": z.array(z.string()),
  "operators.defaultPermissionPreset": preset,

  // Operator runtime
  "operator.preWarm": z.boolean(),
  "operator.taskBudget": z.number().int().positive().optional(),
  "operator.agentProgressSummaries": z.boolean(),
  "operator.defaultEffort": effortLevel.optional(),
  "operator.maxBudgetUsd": z.number().positive().optional(),
  "operator.awaitTimeoutMs": z.number().int().positive(),

  // Best-of-N
  "bestOfN.enabled": z.boolean(),
  "bestOfN.maxCount": z.number().int().positive(),

  // Agent definitions
  "agents.directory": z.string(),

  // Memory
  "memory.syncFromSdk": z.boolean(),
  "memory.maxEntries": z.number().int().positive(),
  "memory.maxPerOperator": z.number().int().positive(),
  "memory.defaultConfidence": z.number().min(0).max(1),
  "memory.decayEnabled": z.boolean(),
  "memory.decayHalfLifeHours": z.number().positive(),

  // Logging
  "log.level": logLevel,

  // MCP
  "mcp.port": z.number().int().positive(),
  "mcp.portRange": z.number().int().positive(),
  "mcp.appsEnabled": z.boolean(),

  // Agent screen
  "agentScreen.mode": agentScreenMode,
  "agentScreen.webPort": z.number().int().positive(),

  // Drive
  "drive.defaultMode": driveMode,
  "drive.confirmGates": z.boolean(),

  // Voice
  "voice.enabled": z.boolean(),
  "voice.wakeWord": z.string(),
  "voice.sleepWord": z.string(),
  "voice.whisperPath": z.string().optional(),

  // Privacy
  "privacy.persistTranscripts": z.boolean(),

  // Approval gates
  "approvalGates.enabled": z.boolean(),
  "approvalGates.blockPatterns": z.array(z.string()),
  "approvalGates.warnPatterns": z.array(z.string()),
  "approvalGates.logPatterns": z.array(z.string()),

  // Status line
  "statusLine.enabled": z.boolean(),
  "statusLine.padding": z.number().int().nonnegative(),
  "statusLine.showModel": z.boolean(),
  "statusLine.showContext": z.boolean(),
  "statusLine.showCost": z.boolean(),
  "statusLine.showDriveState": z.boolean(),
  "statusLine.showOperatorTask": z.boolean(),
  "statusLine.maxTaskLength": z.number().int().positive(),

  // Router
  "router.llmEnabled": z.boolean(),

  // Hooks
  "hooks.enabled": z.boolean(),
  "hooks.directory": z.string(),
  "hooks.definitions": z.array(z.unknown()),

  // Skills
  "skills.directory": z.string(),
  "skills.enabled": z.boolean(),

  // Sessions
  "sessions.maxCheckpoints": z.number().int().positive(),
  "sessions.autoCheckpoint": z.boolean(),
  "sessions.autoCheckpointIntervalMs": z.number().int().positive(),

  // Auto-dream
  "dream.enabled": z.boolean(),
  "dream.intervalMs": z.number().int().positive(),
  "dream.minEntries": z.number().int().nonnegative(),
  "dream.pruneThreshold": z.number().min(0).max(1),
  "dream.mergeThreshold": z.number().min(0).max(1),
  "dream.maxAgeMs": z.number().int().positive(),
};

export interface ValidationIssue {
  key: string;
  value: unknown;
  message: string;
}

export interface ValidationResult {
  /** Whether every known key validated. Unknown keys do not affect this. */
  valid: boolean;
  /** Issues, one per invalid *known* key. */
  errors: ValidationIssue[];
  /**
   * Parsed values for valid known keys. Keys that fail validation are omitted
   * so callers fall back to defaults.
   */
  parsed: Record<string, unknown>;
  /** Keys present in input that have no registered schema. */
  unknownKeys: string[];
}

/** Validate a single key's value against its schema (if any). */
export function validateConfigValue(
  key: string,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const schema = ConfigSchemas[key];
  if (!schema) return { ok: true, value }; // unknown keys are allowed
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    message: result.error.issues.map((i) => `${i.path.join(".") || key}: ${i.message}`).join("; "),
  };
}

/** Validate an entire raw config record (from disk or env). */
export function validateConfig(raw: Record<string, unknown>): ValidationResult {
  const errors: ValidationIssue[] = [];
  const parsed: Record<string, unknown> = {};
  const unknownKeys: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (!(key in ConfigSchemas)) {
      unknownKeys.push(key);
      parsed[key] = value;
      continue;
    }
    const r = validateConfigValue(key, value);
    if (r.ok) parsed[key] = r.value;
    else errors.push({ key, value, message: r.message });
  }

  return { valid: errors.length === 0, errors, parsed, unknownKeys };
}
