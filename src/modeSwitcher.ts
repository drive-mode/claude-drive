/**
 * modeSwitcher.ts — Mode switching with validation and transition rules.
 * Resolves aliases, validates transitions, and wraps driveMode.setSubMode().
 */

import type { DriveModeManager, DriveSubMode } from "./driveMode.js";

const VALID_MODES: DriveSubMode[] = ["plan", "agent", "ask", "debug", "off"];

/** Semantic aliases for mode names */
const MODE_ALIASES: Record<string, DriveSubMode> = {
  planning: "plan",
  "plan mode": "plan",
  coding: "agent",
  implement: "agent",
  "agent mode": "agent",
  question: "ask",
  "ask mode": "ask",
  debugging: "debug",
  "debug mode": "debug",
  stop: "off",
  disable: "off",
  pause: "off",
};

/** Allowed transitions: from -> to[] */
const TRANSITIONS: Record<DriveSubMode, DriveSubMode[]> = {
  plan: ["agent", "ask", "debug", "off"],
  agent: ["plan", "ask", "debug", "off"],
  ask: ["plan", "agent", "debug", "off"],
  debug: ["plan", "agent", "ask", "off"],
  off: ["plan", "agent", "ask"],  // Can't go from off -> debug directly
};

export interface SwitchResult {
  success: boolean;
  from: DriveSubMode;
  to: DriveSubMode;
  error?: string;
}

/**
 * Resolve a mode name from user input (handles aliases and fuzzy matching).
 */
export function resolveModeName(input: string): DriveSubMode | undefined {
  const normalized = input.trim().toLowerCase();
  if (VALID_MODES.includes(normalized as DriveSubMode)) return normalized as DriveSubMode;
  return MODE_ALIASES[normalized];
}

/**
 * Switch mode with validation and transition rules.
 */
export function switchMode(driveMode: DriveModeManager, target: string): SwitchResult {
  const current = driveMode.subMode;
  const resolved = resolveModeName(target);

  if (!resolved) {
    return {
      success: false,
      from: current,
      to: current,
      error: `Unknown mode "${target}". Valid modes: ${VALID_MODES.join(", ")}`,
    };
  }

  if (resolved === current) {
    return { success: true, from: current, to: current };
  }

  const allowed = TRANSITIONS[current];
  if (!allowed.includes(resolved)) {
    return {
      success: false,
      from: current,
      to: resolved,
      error: `Cannot transition from "${current}" to "${resolved}". Allowed: ${allowed.join(", ")}`,
    };
  }

  driveMode.setSubMode(resolved);
  return { success: true, from: current, to: resolved };
}
