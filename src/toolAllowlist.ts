import type { OperatorContext, PermissionPreset } from "./operatorRegistry.js";
import { getConfig } from "./config.js";

// Re-export so callers that previously imported PermissionPreset from here still work.
export type { PermissionPreset } from "./operatorRegistry.js";

export type Capability =
  | "fileRead"
  | "fileWrite"
  | "terminalExecute"
  | "gitRead"
  | "gitWrite"
  | "webSearch"
  | "modelCall";

const PRESET_CAPABILITIES: Record<PermissionPreset, Capability[]> = {
  readonly: ["fileRead", "gitRead", "modelCall"],
  standard: [
    "fileRead",
    "fileWrite",
    "terminalExecute",
    "gitRead",
    "gitWrite",
    "modelCall",
  ],
  full: [
    "fileRead",
    "fileWrite",
    "terminalExecute",
    "gitRead",
    "gitWrite",
    "webSearch",
    "modelCall",
  ],
};

// MCP tool allowlists per preset
const MCP_TOOL_ALLOWLIST: Record<PermissionPreset, string[]> = {
  readonly: [
    "agent_screen_activity",
    "agent_screen_file",
    "agent_screen_decision",
    "agent_screen_clear",
    "agent_screen_chime",
    "tts_speak",
    "tts_stop",
    "operator_list",
    "drive_get_state",
    "persistent_memory_search",
    "persistent_memory_context",
    "worktree_status",
    "session_list",
  ],
  standard: [
    // All readonly tools plus:
    "agent_screen_activity",
    "agent_screen_file",
    "agent_screen_decision",
    "agent_screen_clear",
    "agent_screen_chime",
    "tts_speak",
    "tts_stop",
    "operator_list",
    "drive_get_state",
    "persistent_memory_search",
    "persistent_memory_context",
    "worktree_status",
    "session_list",
    "operator_spawn",
    "operator_switch",
    "operator_dismiss",
    "operator_update_task",
    "operator_update_memory",
    "operator_escalate",
    "drive_run_task",
    "drive_set_mode",
    "worktree_create",
    "worktree_merge",
    "persistent_memory_append",
    "persistent_memory_write_curated",
    "session_save",
    "session_restore",
    "approval_request",
    "approval_respond",
    "sync_proposal_apply",
  ],
  full: ["*"], // All tools
};

// ── Config-based (name-only) API — backward compatible ─────────────────────

function getPreset(agentName: string): PermissionPreset {
  const overrides = getConfig<Record<string, PermissionPreset>>(
    "operators.permissionOverrides"
  ) || {};
  if (overrides[agentName]) {
    return overrides[agentName];
  }
  return getConfig<PermissionPreset>("operators.defaultPermissionPreset") || "standard";
}

export function checkPermission(
  agentName: string,
  capability: Capability
): boolean {
  const preset = getPreset(agentName);
  const allowed = PRESET_CAPABILITIES[preset];
  const permitted = allowed.includes(capability);

  if (!permitted) {
    const msg = `Drive: Agent "${agentName}" (preset: ${preset}) does not have "${capability}" permission.`;
    console.warn(`[Drive Allowlist] ${msg}`);
  }

  return permitted;
}

export function getAllowedCapabilities(agentName: string): Capability[] {
  const preset = getPreset(agentName);
  return PRESET_CAPABILITIES[preset];
}

export function getEffectivePreset(agentName: string): PermissionPreset {
  return getPreset(agentName);
}

// ── Operator-aware API — uses OperatorContext + layered cascade ─────────────
//
// Cascade rule: operator.permissionPreset (already pre-capped at spawn time)
// is the effective preset. Config-level overrides by agent name are applied
// on top — deny always wins (min preset wins).

/**
 * Get the effective preset for an operator.
 *
 * The operator's registry-stored preset (set at spawn, parent cascade already
 * applied) is authoritative. An explicit per-name config override can only
 * further restrict — it can never grant more than the registry preset.
 * The global config "default" preset is intentionally NOT applied here: it is
 * only the fallback for the name-based `checkPermission()` path.
 */
export function getEffectivePresetForOperator(op: OperatorContext): PermissionPreset {
  const registryPreset = op.permissionPreset;
  // Apply only explicit per-name overrides, not the global default.
  const overrides = getConfig<Record<string, PermissionPreset>>(
    "operators.permissionOverrides"
  ) || {};
  const nameOverride = overrides[op.name];
  if (nameOverride) {
    const order: PermissionPreset[] = ["readonly", "standard", "full"];
    return order.indexOf(registryPreset) <= order.indexOf(nameOverride)
      ? registryPreset
      : nameOverride;
  }
  return registryPreset;
}

/**
 * Check whether an operator has a given capability.
 * Uses the registry-stored preset (depth cascade applied at spawn) plus
 * any config-level name override — deny always wins.
 */
export function checkPermissionForOperator(
  op: OperatorContext,
  capability: Capability
): boolean {
  const preset = getEffectivePresetForOperator(op);
  const allowed = PRESET_CAPABILITIES[preset];
  const permitted = allowed.includes(capability);

  if (!permitted) {
    const msg = `Drive: Operator "${op.name}" (depth: ${op.depth}, preset: ${preset}) does not have "${capability}" permission.`;
    console.warn(`[Drive Allowlist] ${msg}`);
  }

  return permitted;
}

/**
 * Return the full list of capabilities for an operator.
 */
export function getAllowedCapabilitiesForOperator(
  op: OperatorContext
): Capability[] {
  const preset = getEffectivePresetForOperator(op);
  return PRESET_CAPABILITIES[preset];
}

/**
 * Check if an MCP tool is allowed for a given preset.
 */
export function isToolAllowedForPreset(
  toolName: string,
  preset: PermissionPreset
): boolean {
  const allowlist = MCP_TOOL_ALLOWLIST[preset];
  if (allowlist.includes("*")) {
    return true; // Full preset allows all
  }
  return allowlist.includes(toolName);
}

/**
 * Get the list of allowed MCP tools for a given preset.
 */
export function getToolAllowlistForPreset(preset: PermissionPreset): string[] {
  return MCP_TOOL_ALLOWLIST[preset];
}
