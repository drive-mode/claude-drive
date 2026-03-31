/**
 * configSchema.ts — Zod schema for claude-drive configuration.
 * Single source of truth for every config key, its type, and its default.
 */
import { z } from "zod";

// Zod v4 .default({}) on an object whose fields all have individual defaults
// doesn't typecheck because TS expects the literal default to satisfy the OUTPUT
// type.  z.preprocess coerces undefined/null → {} BEFORE the object parser runs,
// so inner field defaults still apply.
function withObjectDefault<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => v ?? {}, schema);
}

// ── Sub-schemas ─────────────────────────────────────────────────────────────

const ttsSchema = z.object({
  enabled: z.boolean().default(true),
  backend: z.enum(["say", "edgeTts", "piper"]).default("edgeTts"),
  voice: z.string().optional(),
  edgeTtsVoice: z.string().default("en-US-EmmaMultilingualNeural"),
  speed: z.number().min(0.5).max(2).default(1.0),
  volume: z.number().min(0.2).max(1.0).default(0.8),
  maxSpokenSentences: z.number().int().min(1).default(3),
  interruptOnInput: z.boolean().default(true),
  piperBinaryPath: z.string().optional(),
  piperModelPath: z.string().optional(),
});

const operatorsSchema = z.object({
  maxConcurrent: z.number().int().min(1).default(3),
  maxSubagents: z.number().int().min(0).default(2),
  namePool: z.array(z.string()).default(["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot"]),
  defaultPermissionPreset: z.string().default("standard"),
  timeoutMs: z.number().int().min(1000).default(300000),
  permissionOverrides: z.record(z.string(), z.string()).default({}),
});

const mcpSchema = z.object({
  port: z.number().int().min(1).max(65535).default(7891),
  portRange: z.number().int().min(1).default(5),
  appsEnabled: z.boolean().default(false),
});

const agentScreenSchema = z.object({
  mode: z.enum(["terminal", "web"]).default("terminal"),
  webPort: z.number().int().min(1).max(65535).default(7892),
});

const driveSchema = z.object({
  defaultMode: z.enum(["agent", "plan", "ask", "debug", "off"]).default("agent"),
  confirmGates: z.boolean().default(true),
});

const voiceSchema = z.object({
  enabled: z.boolean().default(false),
  wakeWord: z.string().default("hey drive"),
  sleepWord: z.string().default("go to sleep"),
  whisperPath: z.string().optional(),
});

const privacySchema = z.object({
  persistTranscripts: z.boolean().default(false),
});

const approvalGatesSchema = z.object({
  enabled: z.boolean().default(true),
  blockPatterns: z.array(z.string()).default([]),
  warnPatterns: z.array(z.string()).default([]),
  logPatterns: z.array(z.string()).default([]),
});

const routerSchema = z.object({
  llmEnabled: z.boolean().default(false),
});

const sessionMemorySchema = z.object({
  maxEntries: z.number().int().min(1).default(50),
  tokenBudget: z.number().int().min(1).default(500),
});

const persistentMemorySchema = z.object({
  retentionDays: z.number().int().min(1).default(30),
});

const sanitizerSchema = z.object({
  maxLength: z.number().int().min(1).default(2000),
});

const modelsSchema = z.object({
  routing: z.string().default("claude-haiku-4-5-20251001"),
  planning: z.string().default("claude-sonnet-4-20250514"),
  execution: z.string().default("claude-sonnet-4-20250514"),
  reasoning: z.string().default("claude-opus-4-20250514"),
});

const agentsSchema = z.object({
  tangentKeyword: z.string().default("tangent"),
  tangentAutoConfirm: z.boolean().default(true),
  tangentConfirmationTimeout: z.number().int().min(0).default(5000),
});

const commsAgentSchema = z.object({
  enabled: z.boolean().default(true),
  idleSeconds: z.number().min(1).default(30),
});

const operatorSchema = z.object({
  maxBudgetUsd: z.number().min(0).optional(),
});

const costSchema = z.object({
  tracking: z.boolean().default(true),
  pricing: withObjectDefault(z.object({
    inputPerMToken: z.number().default(3.0),
    outputPerMToken: z.number().default(15.0),
    cacheReadPerMToken: z.number().default(0.30),
    cacheCreationPerMToken: z.number().default(3.75),
  })),
});

const promptOptimizerSchema = z.object({
  enabled: z.boolean().default(true),
});

const verificationSchema = z.object({
  commands: z.array(z.string()).default([]),
  required: z.boolean().default(true),
  maxRetries: z.number().min(0).max(5).default(2),
  timeoutMs: z.number().default(120000),
});

const glossaryEntrySchema = z.object({
  abbreviation: z.string(),
  expansion: z.string(),
});

// ── Root schema ─────────────────────────────────────────────────────────────

const configSchemaInner = z.object({
  tts: withObjectDefault(ttsSchema),
  operators: withObjectDefault(operatorsSchema),
  mcp: withObjectDefault(mcpSchema),
  agentScreen: withObjectDefault(agentScreenSchema),
  drive: withObjectDefault(driveSchema),
  voice: withObjectDefault(voiceSchema),
  privacy: withObjectDefault(privacySchema),
  approvalGates: withObjectDefault(approvalGatesSchema),
  router: withObjectDefault(routerSchema),
  sessionMemory: withObjectDefault(sessionMemorySchema),
  persistentMemory: withObjectDefault(persistentMemorySchema),
  sanitizer: withObjectDefault(sanitizerSchema),
  models: withObjectDefault(modelsSchema),
  agents: withObjectDefault(agentsSchema),
  commsAgent: withObjectDefault(commsAgentSchema),
  operator: withObjectDefault(operatorSchema),
  cost: withObjectDefault(costSchema),
  promptOptimizer: withObjectDefault(promptOptimizerSchema),
  verification: withObjectDefault(verificationSchema),
  glossary: z.array(glossaryEntrySchema).default([]),
});

export const configSchema = z.preprocess(
  (v) => v ?? {},
  configSchemaInner,
);

export type ClaudeDriveConfig = z.infer<typeof configSchemaInner>;

/**
 * Validate raw config data against the schema.
 * On failure: warns about each issue and returns defaults.
 */
export function validateConfig(raw: unknown): ClaudeDriveConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      console.warn(
        `[config] validation warning: ${issue.path.join(".")} — ${issue.message}`,
      );
    }
    return configSchema.parse({}) as ClaudeDriveConfig;
  }
  return result.data as ClaudeDriveConfig;
}
