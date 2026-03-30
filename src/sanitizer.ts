import { getConfig } from "./config.js";

export interface SanitizeResult {
  sanitized: string;
  original: string;
  wasTruncated: boolean;
  injectionPatternsFound: string[];
}

const INJECTION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  {
    label: "ignore_instructions",
    re: /ignore\s+(previous|all|prior)\s+instructions?/gi,
  },
  { label: "system_override", re: /<\/?system>/gi },
  { label: "prompt_end", re: /\[END\s+OF\s+(PROMPT|CONTEXT)\]/gi },
  {
    label: "disregard_above",
    re: /disregard\s+(everything|all)\s+(above|before)/gi,
  },
  { label: "new_instructions", re: /\bNEW\s+INSTRUCTIONS?\s*:/gi },
  { label: "jailbreak_token", re: /\bDAN\b|\bGPT-4\s+DAN\b/g },
];

const DEFAULT_MAX_LENGTH = 2000;

export function sanitizePrompt(
  text: string,
  maxLength?: number
): SanitizeResult {
  const limit =
    maxLength ?? (getConfig<number>("sanitizer.maxLength") || DEFAULT_MAX_LENGTH);

  const original = text;
  const found: string[] = [];

  let result = text;
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.re.test(result)) {
      found.push(pattern.label);
      result = result.replace(pattern.re, "");
    }
  }

  // Collapse whitespace from removed patterns.
  result = result.replace(/\s{2,}/g, " ").trim();

  const wasTruncated = result.length > limit;
  if (wasTruncated) {
    result = result.slice(0, limit).trimEnd();
    // Avoid cutting mid-word — walk back to the last space.
    const lastSpace = result.lastIndexOf(" ");
    if (lastSpace > limit * 0.8) {
      result = result.slice(0, lastSpace);
    }
    result += " [truncated]";
  }

  return {
    sanitized: result,
    original,
    wasTruncated,
    injectionPatternsFound: found,
  };
}
