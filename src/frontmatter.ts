/**
 * frontmatter.ts — Minimal YAML frontmatter parser shared by skill & agent loaders.
 *
 * Handles: flat key/value, inline arrays (`[a, b, c]`), block arrays of objects
 * (e.g. `parameters:` followed by indented `- name: …` blocks). Booleans (`true`/`false`)
 * are coerced; everything else is a string. Quoted values are stripped of wrapping quotes.
 *
 * Not a full YAML implementation — just enough for our definition files.
 */

export interface FrontmatterResult {
  meta: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };

  const rawYaml = match[1];
  const body = match[2].trim();

  const meta: Record<string, unknown> = {};
  const lines = rawYaml.split("\n");
  let currentKey = "";
  let currentArray: unknown[] | null = null;
  let currentObj: Record<string, unknown> | null = null;

  const coerce = (raw: string): unknown => {
    const trimmed = raw.trim().replace(/^["']|["']$/g, "");
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    return trimmed;
  };

  const nextNonEmptyLine = (fromIndex: number): string | undefined => {
    for (let j = fromIndex + 1; j < lines.length; j++) {
      const t = lines[j].trimEnd();
      if (t) return t;
    }
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    // Sub-array items within a parameter object (e.g. "    - one") — not used yet.
    if (currentArray !== null && currentObj !== null && trimmed.match(/^\s{4,}- /)) {
      continue;
    }

    // Property inside an array-item object (e.g. "    description: foo").
    if (currentArray !== null && currentObj !== null && trimmed.match(/^\s{4,}\w/)) {
      const propMatch = trimmed.match(/^\s+(\w+):\s*(.*)$/);
      if (propMatch) currentObj[propMatch[1]] = coerce(propMatch[2]);
      continue;
    }

    // Start of a new array item, possibly with first key inline.
    if (currentArray !== null && trimmed.match(/^\s{2,}- /)) {
      if (currentObj && Object.keys(currentObj).length > 0) {
        currentArray.push(currentObj);
      }
      currentObj = {};
      const propMatch = trimmed.match(/^\s+-\s+(\w+):\s*(.*)$/);
      if (propMatch) currentObj[propMatch[1]] = coerce(propMatch[2]);
      continue;
    }

    // Top-level `key: value` (or `key:` with block value following).
    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      // Flush any pending array
      if (currentArray !== null) {
        if (currentObj && Object.keys(currentObj).length > 0) currentArray.push(currentObj);
        meta[currentKey] = currentArray;
        currentArray = null;
        currentObj = null;
      }

      const key = kvMatch[1];
      const rawVal = kvMatch[2].trim();

      if (!rawVal) {
        const next = nextNonEmptyLine(i);
        if (next !== undefined && /^\s{2,}- /.test(next)) {
          currentKey = key;
          currentArray = [];
          currentObj = null;
        }
        continue;
      }

      // Inline array.
      if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
        meta[key] = rawVal
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter((s) => s.length > 0);
        continue;
      }

      meta[key] = coerce(rawVal);
    }
  }

  // Flush trailing array.
  if (currentArray !== null) {
    if (currentObj && Object.keys(currentObj).length > 0) currentArray.push(currentObj);
    meta[currentKey] = currentArray;
  }

  return { meta, body };
}

/** Resolve `{{name}}` placeholders. */
export function resolveTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? `{{${key}}}`);
}
