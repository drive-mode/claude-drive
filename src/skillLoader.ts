/**
 * skillLoader.ts — Skill discovery, parsing, and registry for claude-drive.
 * Skills are reusable workflow prompts stored as markdown files with YAML frontmatter.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { getConfig } from "./config.js";
import type { OperatorRole, PermissionPreset } from "./operatorRegistry.js";

export interface SkillParameter {
  name: string;
  description: string;
  required?: boolean;
  default?: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  prompt: string;
  tags?: string[];
  requiredRole?: OperatorRole;
  requiredPreset?: PermissionPreset;
  parameters?: SkillParameter[];
  filePath?: string;
}

// ── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };

  const rawYaml = match[1];
  const body = match[2].trim();

  // Simple YAML parser (handles flat key-value, arrays, nested objects for parameters)
  const meta: Record<string, unknown> = {};
  const lines = rawYaml.split("\n");
  let currentKey = "";
  let currentArray: unknown[] | null = null;
  let currentObj: Record<string, unknown> | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    // Array item within a parameter object
    if (currentArray !== null && currentObj !== null && trimmed.match(/^\s{4,}- /)) {
      // Sub-array items - skip for now
      continue;
    }

    // Property within array object
    if (currentArray !== null && currentObj !== null && trimmed.match(/^\s{4,}\w/)) {
      const propMatch = trimmed.match(/^\s+(\w+):\s*(.*)$/);
      if (propMatch) {
        let val: unknown = propMatch[2].trim();
        if (val === "true") val = true;
        else if (val === "false") val = false;
        currentObj[propMatch[1]] = val;
      }
      continue;
    }

    // Start of array item (new object)
    if (currentArray !== null && trimmed.match(/^\s{2,}- /)) {
      if (currentObj && Object.keys(currentObj).length > 0) {
        currentArray.push(currentObj);
      }
      currentObj = {};
      const propMatch = trimmed.match(/^\s+-\s+(\w+):\s*(.*)$/);
      if (propMatch) {
        let val: unknown = propMatch[2].trim();
        if (val === "true") val = true;
        else if (val === "false") val = false;
        currentObj[propMatch[1]] = val;
      }
      continue;
    }

    // Top-level key
    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      // Flush previous array
      if (currentArray !== null) {
        if (currentObj && Object.keys(currentObj).length > 0) {
          currentArray.push(currentObj);
        }
        meta[currentKey] = currentArray;
        currentArray = null;
        currentObj = null;
      }

      const key = kvMatch[1];
      const rawVal = kvMatch[2].trim();

      if (!rawVal) {
        // Might be start of array or nested structure
        currentKey = key;
        currentArray = [];
        currentObj = null;
        continue;
      }

      // Inline array: [tag1, tag2]
      if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
        meta[key] = rawVal.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
        continue;
      }

      // Simple value
      let val: unknown = rawVal;
      if (val === "true") val = true;
      else if (val === "false") val = false;
      meta[key] = val;
    }
  }

  // Flush trailing array
  if (currentArray !== null) {
    if (currentObj && Object.keys(currentObj).length > 0) {
      currentArray.push(currentObj);
    }
    meta[currentKey] = currentArray;
  }

  return { meta, body };
}

function parseSkillFile(content: string, filePath?: string): SkillDefinition | undefined {
  const { meta, body } = parseFrontmatter(content);
  const name = meta.name as string | undefined;
  const description = meta.description as string | undefined;
  if (!name || !description) return undefined;

  return {
    name,
    description,
    prompt: body,
    tags: meta.tags as string[] | undefined,
    requiredRole: meta.requiredRole as OperatorRole | undefined,
    requiredPreset: meta.requiredPreset as PermissionPreset | undefined,
    parameters: meta.parameters as SkillParameter[] | undefined,
    filePath,
  };
}

/** Resolve template variables in a skill prompt: {{name}} → value. */
export function resolveTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => params[key] ?? `{{${key}}}`);
}

// ── Skill Registry ───────────────────────────────────────────────────────────

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();

  loadFromDirectory(dir: string): void {
    try {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), "utf-8");
          const skill = parseSkillFile(content, path.join(dir, file));
          if (skill) {
            this.skills.set(skill.name, skill);
          }
        } catch (e) {
          console.error(`[skills] Failed to load skill ${file}:`, e);
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  resolve(name: string, params?: Record<string, string>): string | undefined {
    const skill = this.skills.get(name);
    if (!skill) return undefined;

    // Validate required parameters
    if (skill.parameters) {
      for (const p of skill.parameters) {
        if (p.required && (!params || !params[p.name])) {
          throw new Error(`Missing required parameter: ${p.name}`);
        }
      }
    }

    // Build params with defaults
    const resolved: Record<string, string> = {};
    if (skill.parameters) {
      for (const p of skill.parameters) {
        const val = params?.[p.name] ?? p.default;
        if (val !== undefined) resolved[p.name] = val;
      }
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (!(k in resolved)) resolved[k] = v;
      }
    }

    return resolveTemplate(skill.prompt, resolved);
  }
}

/** Singleton skill registry. */
export const skillRegistry = new SkillRegistry();

/** Load skills from the default directory. */
export function loadDefaultSkills(): void {
  const dir = getConfig<string>("skills.directory")
    ?? path.join(os.homedir(), ".claude-drive", "skills");
  const expanded = dir.replace(/^~/, os.homedir());
  skillRegistry.loadFromDirectory(expanded);
}
