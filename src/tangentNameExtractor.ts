/**
 * tangentNameExtractor.ts — Extract agent name and task from tangent command text.
 * Uses regex (Tier 0) first, then model-based extraction (Tier 1) for ambiguous cases.
 * Ported from cursor-drive: replaced vscode.LanguageModel API → Anthropic SDK.
 */

export interface TangentParseResult {
  name?: string;
  task: string;
}

/** Regex: "call it X — task" or "X — task" or "X: task" (explicit separator). */
const EXPLICIT_SEP_RE = /^(?:call\s+it\s+)?(.+?)\s*[-—:]\s*(.+)$/s;

/**
 * Try regex extraction first. Returns undefined if no match.
 */
function tryRegexExtract(textAfterTangent: string): TangentParseResult | undefined {
  const m = textAfterTangent.trim().match(EXPLICIT_SEP_RE);
  if (!m) return undefined;
  const name = m[1].trim();
  const task = m[2].trim();
  if (!task) return undefined;
  return { name, task };
}

const EXTRACT_SYSTEM_PROMPT = `You extract agent name and task from a tangent command.
The user said "tangent" followed by text. Determine if they gave a custom agent name.

Rules:
- If they said something like "call it X" or "X — task" or "X, task", extract name and task.
- Names can be multi-word (e.g. "The Godly Knight"). Case insensitive.
- If no clear name, return task only.
- Output JSON only: {"name": "Name" or null, "task": "the task"}.
- If name is clearly the main/primary agent (e.g. "Drive", "main", "primary"), use null.`;

/**
 * Use Tier-1 model (Anthropic SDK) to extract name and task from ambiguous text.
 * Falls back to regex-only if API key is not available.
 */
async function extractViaModel(textAfterTangent: string): Promise<TangentParseResult> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return { task: textAfterTangent.trim() };
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `${EXTRACT_SYSTEM_PROMPT}\n\nText after "tangent":\n${textAfterTangent}`,
        },
      ],
    });

    let raw = "";
    for (const block of message.content) {
      if (block.type === "text") {
        raw += block.text;
      }
    }

    try {
      const parsed = JSON.parse(raw.trim()) as { name?: string | null; task?: string };
      const name = parsed.name && String(parsed.name).trim() ? String(parsed.name).trim() : undefined;
      const task = parsed.task && String(parsed.task).trim() ? String(parsed.task).trim() : textAfterTangent.trim();
      return { name, task };
    } catch (err) {
      console.warn("[tangent] name extraction failed (JSON parse):", err);
      return { task: textAfterTangent.trim() };
    }
  } catch (err) {
    console.warn("[tangent] name extraction failed:", err);
    return { task: textAfterTangent.trim() };
  }
}

/**
 * Extract name and task from text that follows the tangent keyword.
 * Tries regex first (Tier 0), then model (Tier 1) for ambiguous input.
 */
export async function extractTangentNameAndTask(
  textAfterTangent: string
): Promise<TangentParseResult> {
  const regexResult = tryRegexExtract(textAfterTangent);
  if (regexResult) return regexResult;
  return extractViaModel(textAfterTangent);
}
