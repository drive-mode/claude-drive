/**
 * glossaryExpander.ts — Expand glossary triggers (e.g., "tangent" → "tangent — spawn a parallel agent for").
 * Ported from cursor-drive: replaced vscode.workspace.getConfiguration() → getConfig().
 * Loads user glossary from config + builtin glossary.
 */

import { getConfig } from "./config.js";

export interface GlossaryEntry {
  trigger: string;
  expansion: string;
  /** Precompiled regex for matching trigger (set when loading). */
  regex?: RegExp;
}

export interface GlossaryExpandResult {
  expanded: string;
  original: string;
  wasExpanded: boolean;
  matchedTriggers: string[];
}

const WS_COLLAPSE_RE = /\s{2,}/g;

const BUILTIN_GLOSSARY: GlossaryEntry[] = [
  { trigger: "tangent", expansion: "tangent — spawn a parallel agent for" },
  { trigger: "hey drive", expansion: "" }, // activation phrase — strip it
  { trigger: "send it", expansion: "" }, // submit phrase — strip it
  { trigger: "go ahead", expansion: "proceed and implement" },
  { trigger: "send", expansion: "" }, // common submit word — strip
];

let glossaryCache: GlossaryEntry[] | null = null;

function compileTriggerRegex(trigger: string): RegExp {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "gi");
}

export function loadGlossary(): GlossaryEntry[] {
  if (glossaryCache) { return glossaryCache; }
  const userEntries = getConfig<GlossaryEntry[]>("glossary") ?? [];
  const all = [...userEntries, ...BUILTIN_GLOSSARY];
  glossaryCache = all.map((e) => ({
    ...e,
    regex: e.trigger.trim() ? compileTriggerRegex(e.trigger) : undefined,
  }));
  return glossaryCache;
}

function ensureRegex(entry: GlossaryEntry): GlossaryEntry {
  if (entry.regex) { return entry; }
  const trigger = entry.trigger.trim();
  return {
    ...entry,
    regex: trigger ? compileTriggerRegex(trigger) : undefined,
  };
}

export function expandGlossary(
  text: string,
  glossary?: GlossaryEntry[]
): GlossaryExpandResult {
  const raw = glossary ?? loadGlossary();
  const entries = raw.map(ensureRegex);
  const original = text;
  const matched: string[] = [];

  // Sort by trigger length descending so longer phrases match before shorter substrings.
  const sorted = [...entries].sort((a, b) => b.trigger.length - a.trigger.length);

  let result = text;
  for (const entry of sorted) {
    const re = entry.regex;
    if (!re) { continue; }
    re.lastIndex = 0;
    if (re.test(result)) {
      matched.push(entry.trigger);
      re.lastIndex = 0;
      result = result.replace(re, entry.expansion);
    }
  }

  // Collapse extra whitespace introduced by empty-expansion strips.
  WS_COLLAPSE_RE.lastIndex = 0;
  result = result.replace(WS_COLLAPSE_RE, " ").trim();

  return {
    expanded: result,
    original,
    wasExpanded: matched.length > 0,
    matchedTriggers: matched,
  };
}

/**
 * Invalidate the glossary cache (call when config changes or glossary needs reload).
 */
export function invalidateGlossaryCache(): void {
  glossaryCache = null;
}
