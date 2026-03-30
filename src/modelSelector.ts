/**
 * modelSelector.ts — Tiered model routing for Claude models.
 * Selects appropriate models based on task tier and execution mode.
 */

import { getConfig } from "./config.js";

export type ModelTier = "routing" | "planning" | "execution" | "reasoning";
export type RouteMode = "plan" | "agent" | "ask" | "debug";

/**
 * Default models for each tier.
 * Can be overridden via config: models.<tier>
 */
export const MODEL_TIERS: Record<ModelTier, string> = {
  routing: "claude-3-5-haiku-20241022",
  planning: "claude-sonnet-4-20250514",
  execution: "claude-sonnet-4-20250514",
  reasoning: "claude-opus-4-20250514",
};

/**
 * Get the model for a given tier.
 * Checks config first, falls back to defaults.
 */
export function getModelForTier(tier: ModelTier): string {
  const configured = getConfig<string>(`models.${tier}`);
  if (configured) {
    return configured;
  }
  return MODEL_TIERS[tier];
}

/**
 * Map a route mode to the appropriate model tier.
 */
export function tierForMode(mode: RouteMode): ModelTier {
  switch (mode) {
    case "plan":
      return "planning";
    case "debug":
      return "reasoning";
    case "agent":
    case "ask":
    default:
      return "execution";
  }
}

/**
 * Get the model to use for a given route mode.
 */
export function getModelForMode(mode: RouteMode): string {
  const tier = tierForMode(mode);
  return getModelForTier(tier);
}
