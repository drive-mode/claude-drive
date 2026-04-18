/**
 * skillLoader.ts — Skill discovery, parsing, and registry for claude-drive.
 * Skills are reusable workflow prompts stored as markdown files with YAML frontmatter.
 */
import fs from "fs";
import path from "path";
import { getConfig } from "./config.js";
import { skillsDir, expandUserHome } from "./paths.js";
import type { OperatorRole, PermissionPreset } from "./operatorRegistry.js";
import { parseFrontmatter, resolveTemplate as _resolveTemplate } from "./frontmatter.js";
import { logger } from "./logger.js";

// Re-export for backwards compatibility and for other loaders that imported
// `resolveTemplate` from here.
export { parseFrontmatter } from "./frontmatter.js";

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
export const resolveTemplate = _resolveTemplate;

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
          logger.error(`[skills] Failed to load skill ${file}:`, e);
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
  const configured = getConfig<string>("skills.directory");
  const dir = configured ? expandUserHome(configured) : skillsDir();
  skillRegistry.loadFromDirectory(dir);
}
