/**
 * reflectionGate.ts — Self-reflection gates via Agent SDK hooks for claude-drive.
 *
 * Builds SDK hook callbacks that inject role-specific reflection questions at runtime.
 * Also defines "reflector" and "best-practices" subagents for post-task review.
 *
 * Inspired by Andrej Karpathy's AutoResearch framework — the highest-impact pattern
 * is a single self-reflection gate that catches unfulfilled promises and commitments.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { getConfig } from "./config.js";
import { atomicWriteJSON } from "./atomicWrite.js";
import type { OperatorRole } from "./operatorRegistry.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type ReflectionHookEvent = "UserPromptSubmit" | "PostToolUse" | "Stop" | "PreToolUse";

export interface ReflectionRule {
  id: string;
  question: string;
  hookEvent: ReflectionHookEvent;
  roles?: OperatorRole[];       // undefined = all roles
  toolMatcher?: string;         // regex for PreToolUse/PostToolUse hooks
  tags?: string[];
  enabled: boolean;
  priority: number;             // lower = fires first
}

// SDK hook callback type (matches Agent SDK expectations)
type HookCallback = (input: unknown) => Promise<Record<string, unknown>>;

export interface ReflectionHooks {
  UserPromptSubmit?: Array<{ hooks: HookCallback[] }>;
  PostToolUse?: Array<{ matcher: string; hooks: HookCallback[] }>;
  Stop?: Array<{ hooks: HookCallback[] }>;
  PreToolUse?: Array<{ matcher: string; hooks: HookCallback[] }>;
}

// ── Default Rules ───────────────────────────────────────────────────────────

const DEFAULT_RULES: ReflectionRule[] = [
  {
    id: "follow-through",
    question: "Does this response contain promises to do something later? If yes, flag them — the operator should either do it now or explicitly schedule it.",
    hookEvent: "Stop",
    tags: ["commitment", "follow-through"],
    enabled: true,
    priority: 10,
  },
  {
    id: "completeness",
    question: "Did the response address every part of the original request? List any gaps.",
    hookEvent: "Stop",
    roles: ["implementer", "planner"],
    tags: ["completeness"],
    enabled: true,
    priority: 20,
  },
  {
    id: "safety-check",
    question: "Is this operation reversible? What is the blast radius if it goes wrong?",
    hookEvent: "PreToolUse",
    toolMatcher: "Bash|Edit|Write",
    tags: ["safety"],
    enabled: true,
    priority: 10,
  },
  {
    id: "scope-guard",
    question: "Focus only on what was requested. Do not add unrequested improvements, refactoring, or extra features.",
    hookEvent: "UserPromptSubmit",
    roles: ["implementer"],
    tags: ["scope"],
    enabled: true,
    priority: 10,
  },
  {
    id: "test-reminder",
    question: "Code was changed. Were tests updated to cover this change?",
    hookEvent: "PostToolUse",
    roles: ["implementer"],
    toolMatcher: "Edit|Write",
    tags: ["testing"],
    enabled: true,
    priority: 30,
  },
];

// ── Persistence ─────────────────────────────────────────────────────────────

function getRulesFilePath(): string {
  const configured = getConfig<string>("reflection.rulesFile");
  if (configured) return configured.replace(/^~/, os.homedir());
  return path.join(os.homedir(), ".claude-drive", "reflection-rules.json");
}

function loadCustomRules(): ReflectionRule[] {
  const filePath = getRulesFilePath();
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as ReflectionRule[];
    }
  } catch {
    // Corrupted file — fall back to empty
  }
  return [];
}

function saveCustomRules(rules: ReflectionRule[]): void {
  atomicWriteJSON(getRulesFilePath(), rules);
}

// In-memory custom rules cache (loaded once, then managed)
let customRules: ReflectionRule[] | null = null;

function getCustomRules(): ReflectionRule[] {
  if (customRules === null) {
    customRules = loadCustomRules();
  }
  return customRules;
}

// ── Rule Management ─────────────────────────────────────────────────────────

/** Get all reflection rules (defaults + custom), sorted by priority. */
export function getReflectionRules(): ReflectionRule[] {
  const all = [...DEFAULT_RULES, ...getCustomRules()];
  return all.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);
}

/** Get built-in default rules only. */
export function getDefaultRules(): ReflectionRule[] {
  return [...DEFAULT_RULES];
}

/** Add a custom reflection rule. Returns the created rule with generated ID. */
export function addReflectionRule(rule: Omit<ReflectionRule, "id">): ReflectionRule {
  const newRule: ReflectionRule = {
    ...rule,
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const rules = getCustomRules();
  rules.push(newRule);
  customRules = rules;
  saveCustomRules(rules);
  return newRule;
}

/** Remove a custom reflection rule by ID. Returns true if found and removed. */
export function removeReflectionRule(id: string): boolean {
  const rules = getCustomRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  rules.splice(idx, 1);
  customRules = rules;
  saveCustomRules(rules);
  return true;
}

/** Toggle a reflection rule on or off. Works for both default and custom rules. */
export function toggleReflectionRule(id: string, enabled: boolean): void {
  // Check custom rules first
  const rules = getCustomRules();
  const custom = rules.find((r) => r.id === id);
  if (custom) {
    custom.enabled = enabled;
    customRules = rules;
    saveCustomRules(rules);
    return;
  }
  // For default rules, store override as a custom rule with same ID
  const defaultRule = DEFAULT_RULES.find((r) => r.id === id);
  if (defaultRule) {
    const override: ReflectionRule = { ...defaultRule, enabled };
    rules.push(override);
    customRules = rules;
    saveCustomRules(rules);
  }
}

/** Reset custom rules cache (useful for testing). */
export function resetRulesCache(): void {
  customRules = null;
}

// ── SDK Hook Builders ───────────────────────────────────────────────────────

/** Filter rules by role and hook event. */
function filterRules(event: ReflectionHookEvent, role?: OperatorRole): ReflectionRule[] {
  return getReflectionRules().filter((r) => {
    if (r.hookEvent !== event) return false;
    if (r.roles && role && !r.roles.includes(role)) return false;
    if (r.roles && !role) return false;  // role-specific rules don't apply when no role
    return true;
  });
}

/** Build a hook callback that injects a reflection question as a systemMessage. */
function makeReflectionCallback(rule: ReflectionRule): HookCallback {
  return async (_input: unknown) => ({
    systemMessage: `[Reflection Gate: ${rule.id}] ${rule.question}`,
  });
}

/**
 * Build Agent SDK hook configs ready to pass to query() options.hooks.
 * Returns hook arrays keyed by event type, filtered for the given operator role.
 */
export function buildReflectionHooks(role?: OperatorRole): ReflectionHooks {
  const enabled = getConfig<boolean>("reflection.enabled") ?? true;
  if (!enabled) return {};

  const hooks: ReflectionHooks = {};

  // UserPromptSubmit hooks
  const userPromptRules = filterRules("UserPromptSubmit", role);
  if (userPromptRules.length > 0) {
    hooks.UserPromptSubmit = [{
      hooks: userPromptRules.map(makeReflectionCallback),
    }];
  }

  // Stop hooks
  const stopRules = filterRules("Stop", role);
  if (stopRules.length > 0) {
    hooks.Stop = [{
      hooks: stopRules.map(makeReflectionCallback),
    }];
  }

  // PreToolUse hooks — grouped by toolMatcher
  const preToolRules = filterRules("PreToolUse", role);
  if (preToolRules.length > 0) {
    const byMatcher = new Map<string, ReflectionRule[]>();
    for (const rule of preToolRules) {
      const matcher = rule.toolMatcher ?? ".*";
      const group = byMatcher.get(matcher) ?? [];
      group.push(rule);
      byMatcher.set(matcher, group);
    }
    hooks.PreToolUse = Array.from(byMatcher.entries()).map(([matcher, rules]) => ({
      matcher,
      hooks: rules.map(makeReflectionCallback),
    }));
  }

  // PostToolUse hooks — grouped by toolMatcher
  const postToolRules = filterRules("PostToolUse", role);
  if (postToolRules.length > 0) {
    const byMatcher = new Map<string, ReflectionRule[]>();
    for (const rule of postToolRules) {
      const matcher = rule.toolMatcher ?? ".*";
      const group = byMatcher.get(matcher) ?? [];
      group.push(rule);
      byMatcher.set(matcher, group);
    }
    hooks.PostToolUse = Array.from(byMatcher.entries()).map(([matcher, rules]) => ({
      matcher,
      hooks: rules.map(makeReflectionCallback),
    }));
  }

  return hooks;
}

// ── Subagent Definitions ────────────────────────────────────────────────────

/** Reflector subagent — lightweight post-task review for completeness and commitments. */
export function buildReflectorAgent(): {
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
} {
  const model = getConfig<string>("reflection.reflectorModel") ?? "haiku";
  return {
    description: "Reviews operator output for quality, completeness, and unfulfilled commitments",
    prompt: [
      "You are a reflection reviewer. Analyze the given output and check:",
      "1. Are there unfulfilled promises or commitments to do something later?",
      "2. Was every part of the original request addressed?",
      "3. Are there risks, edge cases, or TODOs left unhandled?",
      "4. Is there scope creep — work done that wasn't requested?",
      "",
      "Return a brief verdict: PASS (no issues) or FAIL (list specific issues).",
    ].join("\n"),
    tools: ["Read", "Grep", "Glob"],
    model,
  };
}

/** Best Practices Verifier subagent — checks code against Claude/Agent SDK best practices. */
export function buildBestPracticesAgent(): {
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
} {
  return {
    description: "Verifies code follows Claude API and Agent SDK best practices",
    prompt: [
      "You are a Claude best practices reviewer. Check the operator's work against these guidelines:",
      "",
      "## Claude API Best Practices",
      "- Structured prompts with clear system/user separation",
      "- Proper use of tool_use and tool_result message types",
      "- Streaming responses for long operations",
      "- Appropriate max_tokens settings (not too high, not too low)",
      "- Using the right model for the task (haiku for simple, sonnet for balanced, opus for complex)",
      "",
      "## Agent SDK Best Practices",
      "- Hooks: Use PreToolUse for gating, PostToolUse for observation, Stop for cleanup",
      "- Subagents: Scoped tools (never give Agent tool to subagents), focused prompts",
      "- Permission presets: Least privilege — readonly when possible, standard for edits",
      "- AbortController wired through for cancellation support",
      "- maxTurns set reasonably (not infinite loops)",
      "- maxBudgetUsd set for cost control",
      "- MCP servers declared explicitly, not dynamically constructed",
      "- System prompts: concise, role-focused, no bloat",
      "",
      "## Code Quality for Claude Integrations",
      "- ESM imports with .js extensions",
      "- Proper error handling around SDK calls (lazy import pattern)",
      "- Atomic writes for state persistence",
      "- Config via getConfig/saveConfig, not hardcoded values",
      "",
      "Flag violations with severity (critical/warning/info) and suggest fixes.",
    ].join("\n"),
    tools: ["Read", "Grep", "Glob", "WebSearch"],
    model: "sonnet",
  };
}
