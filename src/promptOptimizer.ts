/**
 * promptOptimizer.ts — LLM-based voice input cleanup for claude-drive.
 * Uses a cheap model to clean up messy voice-transcribed prompts before routing.
 * Skips optimization for short/clean prompts or when disabled.
 */

import { getConfig } from "./config.js";

export interface OptimizeResult {
  original: string;
  optimized: string;
  wasOptimized: boolean;
}

const OPTIMIZE_SYSTEM = `Clean up this voice-transcribed developer command. Fix filler words, hesitations, and grammar while preserving the technical intent exactly. If the input is already clean, return it unchanged. Output ONLY the cleaned text, nothing else.`;

const FILLER_WORDS = /\b(uh+|um+|like|basically|you know|kind of|sort of|I guess|I mean)\b/i;

function hasFillerWords(text: string): boolean {
  return FILLER_WORDS.test(text);
}

/**
 * Optimize a prompt — clean up voice artifacts before routing.
 * Skips optimization for short/clean prompts.
 */
export async function optimizePrompt(raw: string): Promise<OptimizeResult> {
  const trimmed = raw.trim();

  // Skip optimization for short/clean prompts
  if (trimmed.length < 80 && !hasFillerWords(trimmed)) {
    return { original: trimmed, optimized: trimmed, wasOptimized: false };
  }

  // Skip if disabled
  if (!getConfig<boolean>("promptOptimizer.enabled")) {
    return { original: trimmed, optimized: trimmed, wasOptimized: false };
  }

  // Skip if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return { original: trimmed, optimized: trimmed, wasOptimized: false };
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const modelId = getConfig<string>("models.routing") ?? "claude-haiku-4-5-20251001";

    const response = await client.messages.create({
      model: modelId,
      max_tokens: 200,
      messages: [
        { role: "user", content: `${OPTIMIZE_SYSTEM}\n\nInput: ${trimmed}` },
      ],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();

    if (text && text !== trimmed) {
      return { original: trimmed, optimized: text, wasOptimized: true };
    }
  } catch (err) {
    console.warn("[promptOptimizer] optimization failed:", err);
  }

  return { original: trimmed, optimized: trimmed, wasOptimized: false };
}
