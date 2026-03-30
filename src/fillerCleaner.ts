/**
 * fillerCleaner.ts — Remove filler words and clean up dictation.
 * Ported directly from cursor-drive (pure TypeScript, no dependencies).
 */

export interface CleanResult {
  cleaned: string;
  original: string;
  wasModified: boolean;
}

const FILLER_WORDS = [
  "uhh", "uh", "umm", "um", "err", "hmm",
  "like", "you know", "you know what i mean",
  "kinda", "sorta", "sort of", "kind of",
  "basically", "literally", "actually",
  "i mean", "i guess", "i think maybe",
  "or whatever", "or something", "or anything",
  "right\\?", "right$",
  "does that make sense\\?",
  "if that makes sense",
  "i don't know", "idk", "not sure",
  "maybe", "perhaps",
];

const FILLER_REGEXES = FILLER_WORDS.map((f) => new RegExp(`\\b${f}\\b[,.]?\\s*`, "gi"));
const FILLER_BOUNDARY_REGEXES = FILLER_WORDS.map((f) => new RegExp(`\\b${f}\\b`, "i"));
const TRAILING_PATTERNS = [
  /[.…\s]*(right\??|yeah\??|ok\??)?\s*$/i,
];
const DUPLICATE_WORDS_RE = /\b(\w+(?:\s+\w+){0,2})\s+\1\b/gi;
const WS_COLLAPSE_RE = /\s{2,}/g;
const TRIM_PUNCT_RE = /^[\s,;.]+|[\s,;.]+$/g;

export function cleanFillerWords(raw: string): CleanResult {
  if (!raw || !raw.trim()) {
    return { cleaned: raw, original: raw, wasModified: false };
  }

  let text = raw;

  for (const pattern of FILLER_REGEXES) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, " ");
  }

  // Collapse duplicate adjacent words: "can you can you" → "can you"
  DUPLICATE_WORDS_RE.lastIndex = 0;
  text = text.replace(DUPLICATE_WORDS_RE, "$1");

  // Collapse runs of whitespace / punctuation left behind.
  WS_COLLAPSE_RE.lastIndex = 0;
  text = text.replace(WS_COLLAPSE_RE, " ");
  TRIM_PUNCT_RE.lastIndex = 0;
  text = text.replace(TRIM_PUNCT_RE, "").trim();

  // Restore sentence casing if the original started with a capital.
  if (raw.length > 0 && raw[0] === raw[0].toUpperCase() && text.length > 0) {
    text = text[0].toUpperCase() + text.slice(1);
  }

  const wasModified = text.trim() !== raw.trim();
  return { cleaned: text.trim() || raw.trim(), original: raw, wasModified };
}

export function looksLikeDictation(text: string): boolean {
  const lower = text.toLowerCase();
  const fillerHits = FILLER_BOUNDARY_REGEXES.filter((re) => re.test(lower)).length;
  const hasTrailingUncertainty = TRAILING_PATTERNS.some((p) => p.test(text));
  const wordCount = text.split(/\s+/).length;
  return fillerHits > 0 && (fillerHits / wordCount > 0.1 || hasTrailingUncertainty);
}
