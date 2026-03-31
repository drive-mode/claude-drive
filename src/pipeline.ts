/**
 * pipeline.ts — Prompt processing pipeline for claude-drive.
 * Multi-stage processing: filler cleaning → glossary expansion → sanitization →
 * approval gates → memory injection → intent routing → model selection.
 * Ported from cursor-drive, removing VS Code dependencies.
 */

import { cleanFillerWords } from "./fillerCleaner.js";
import { expandGlossary } from "./glossaryExpander.js";
import { sanitizePrompt } from "./sanitizer.js";
import { getGateResult, type GateResult } from "./approvalGates.js";
import { route, type RouteDecision } from "./router.js";
import { getModelForMode, tierForMode, type ModelTier } from "./modelSelector.js";
import { optimizePrompt } from "./promptOptimizer.js";
import type { OperatorRegistry } from "./operatorRegistry.js";
import type { SessionMemory } from "./sessionMemory.js";
import type { PersistentMemory } from "./persistentMemory.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PipelineContext {
  driveActive: boolean;
  driveSubMode?: string;
  sessionMemory?: SessionMemory;
  persistentMemory?: PersistentMemory;
  operatorRegistry?: OperatorRegistry;
}

export type PipelineResult =
  | { ok: true; prompt: string; route: RouteDecision; model: ModelTier }
  | { ok: false; blocked: true; gateResult?: GateResult };

export interface PipelineStats {
  totalPrompts: number;
  promptOptimized: number;
  fillerCleaned: number;
  glossaryExpanded: number;
  injectionsPrevented: number;
  blockedByGate: number;
  averageLength: number;
}

// ── Stats tracking ───────────────────────────────────────────────────────────

const stats: PipelineStats = {
  totalPrompts: 0,
  promptOptimized: 0,
  fillerCleaned: 0,
  glossaryExpanded: 0,
  injectionsPrevented: 0,
  blockedByGate: 0,
  averageLength: 0,
};

export function getPipelineStats(): Readonly<PipelineStats> {
  return { ...stats };
}

export function resetPipelineStats(): void {
  stats.totalPrompts = 0;
  stats.promptOptimized = 0;
  stats.fillerCleaned = 0;
  stats.glossaryExpanded = 0;
  stats.injectionsPrevented = 0;
  stats.blockedByGate = 0;
  stats.averageLength = 0;
}

// ── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Process a user prompt through the full pipeline.
 *
 * Stages:
 * 1. Filler cleaning (uhh, um, etc.)
 * 2. Glossary expansion (tangent → "tangent — spawn...", etc.)
 * 3. Sanitization (remove injection patterns, truncate if needed)
 * 4. Approval gates (block/warn/log based on safety policy)
 * 5. Session memory injection (recent context)
 * 6. Persistent memory injection (long-term context)
 * 7. Intent routing (plan/agent/ask/debug)
 * 8. Model selection (based on mode)
 *
 * @param rawPrompt — User input (uncleaned)
 * @param context — Pipeline context (drive state, memories, registry)
 * @param operatorId — Optional operator ID for gate evaluation
 * @returns PipelineResult with processed prompt or blockage reason
 */
export async function processPipeline(
  rawPrompt: string,
  context: PipelineContext,
  operatorId?: string
): Promise<PipelineResult> {
  stats.totalPrompts++;

  let prompt = rawPrompt;

  // Stage 0: LLM prompt optimization (heavy voice cleanup)
  const optimizeResult = await optimizePrompt(prompt);
  if (optimizeResult.wasOptimized) {
    stats.promptOptimized++;
    console.log(`[pipeline] Prompt optimized: "${optimizeResult.original.slice(0, 60)}..." → "${optimizeResult.optimized.slice(0, 60)}..."`);
    prompt = optimizeResult.optimized;
  }

  // Stage 1: Filler cleaning
  const fillerResult = cleanFillerWords(prompt);
  if (fillerResult.wasModified) {
    stats.fillerCleaned++;
  }
  prompt = fillerResult.cleaned;

  // Stage 2: Glossary expansion
  const glossaryResult = expandGlossary(prompt);
  if (glossaryResult.wasExpanded) {
    stats.glossaryExpanded++;
  }
  prompt = glossaryResult.expanded;

  // Stage 3: Sanitization (injection prevention)
  const sanitizeResult = sanitizePrompt(prompt);
  if (sanitizeResult.injectionPatternsFound.length > 0) {
    stats.injectionsPrevented++;
  }
  prompt = sanitizeResult.sanitized;

  // Stage 4: Approval gates (safety check)
  const gateResult = getGateResult(prompt, operatorId);
  if (gateResult.action === "block") {
    stats.blockedByGate++;
    return { ok: false, blocked: true, gateResult };
  }

  // Stage 5: Session memory injection
  let memoryContext = "";
  if (context.sessionMemory) {
    const sessionContext = context.sessionMemory.buildContextString();
    if (sessionContext) {
      memoryContext += sessionContext + "\n\n";
    }
  }

  // Stage 6: Persistent memory injection
  if (context.persistentMemory) {
    try {
      const persistentContext = await context.persistentMemory.buildPromptContext();
      if (persistentContext) {
        memoryContext += persistentContext + "\n\n";
      }
    } catch (error) {
      console.error("[pipeline] Failed to build persistent memory context:", error);
    }
  }

  // Combine memory context with prompt.
  const fullPrompt = memoryContext ? `${memoryContext}${prompt}` : prompt;

  // Stage 7: Intent routing
  const routeDecision = route({
    prompt: fullPrompt,
    driveSubMode: context.driveSubMode,
  });

  // Stage 8: Model selection
  const modelTier = tierForMode(routeDecision.mode);

  // Update stats
  stats.averageLength = (stats.averageLength * (stats.totalPrompts - 1) + fullPrompt.length) / stats.totalPrompts;

  return {
    ok: true,
    prompt: fullPrompt,
    route: routeDecision,
    model: modelTier,
  };
}

/**
 * Lightweight version for quick intent detection without full processing.
 * Used when you only need routing, not the full pipeline.
 */
export function processQuickRoute(
  prompt: string,
  driveSubMode?: string
): RouteDecision {
  return route({
    prompt,
    driveSubMode,
  });
}

/**
 * Test whether a prompt would be blocked by approval gates.
 */
export function wouldBeBlocked(prompt: string, operatorId?: string): boolean {
  const gateResult = getGateResult(prompt, operatorId);
  return gateResult.action === "block";
}
