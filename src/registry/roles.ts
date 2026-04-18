/**
 * registry/roles.ts — Role templates and permission-preset ordering.
 *
 * Pure data + one small helper. Lives outside `operatorRegistry.ts` so the
 * class file can focus on lifecycle behaviour.
 */
import type { OperatorRole, PermissionPreset } from "./types.js";

export interface RoleTemplate {
  defaultPreset: PermissionPreset;
  description: string;
  systemHint: string;
}

export const ROLE_TEMPLATES: Record<OperatorRole, RoleTemplate> = {
  implementer: {
    defaultPreset: "standard",
    description: "Writes and modifies code",
    systemHint:
      "You are an implementer. Write production-quality code, follow existing patterns, and report files touched via agent_screen_file.",
  },
  reviewer: {
    defaultPreset: "readonly",
    description: "Reviews code without modifying files",
    systemHint:
      "You are a reviewer. Analyze code for bugs, risks, and quality. Do NOT edit files. Report findings via agent_screen_decision.",
  },
  tester: {
    defaultPreset: "standard",
    description: "Writes and runs tests",
    systemHint:
      "You are a tester. Write test cases, run test suites, and verify behavior. Report test results via agent_screen_activity.",
  },
  researcher: {
    defaultPreset: "readonly",
    description: "Researches solutions and gathers context",
    systemHint:
      "You are a researcher. Explore the codebase, read documentation, and synthesize findings. Do NOT edit production files.",
  },
  planner: {
    defaultPreset: "readonly",
    description: "Creates plans and breaks down tasks",
    systemHint:
      "You are a planner. Analyze requirements, break tasks into actionable steps, and produce plan artifacts. Do NOT implement code.",
  },
};

const PRESET_ORDER: PermissionPreset[] = ["readonly", "standard", "full"];

/** Return the more-restrictive of two presets (readonly < standard < full). */
export function minPreset(a: PermissionPreset, b: PermissionPreset): PermissionPreset {
  return PRESET_ORDER.indexOf(a) <= PRESET_ORDER.indexOf(b) ? a : b;
}

/** Validate and narrow a CLI/MCP-supplied role string. Returns `undefined` if invalid. */
export function parseRole(value: string | undefined): import("./types.js").OperatorRole | undefined {
  if (!value) return undefined;
  return value in ROLE_TEMPLATES ? (value as import("./types.js").OperatorRole) : undefined;
}

/** Validate and narrow a CLI/MCP-supplied preset string. Returns `undefined` if invalid. */
export function parsePreset(value: string | undefined): PermissionPreset | undefined {
  if (!value) return undefined;
  return (PRESET_ORDER as readonly string[]).includes(value) ? (value as PermissionPreset) : undefined;
}
