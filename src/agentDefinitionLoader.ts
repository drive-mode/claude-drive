/**
 * agentDefinitionLoader.ts — Custom agent definition files for claude-drive.
 *
 * Agents are `.md` files with YAML frontmatter that configure a pre-defined
 * operator. They are discovered from three scopes, in priority order:
 *
 *   1. `builtin`  — code-defined (registered via `registerBuiltinAgents()`)
 *   2. `user`     — `~/.claude-drive/agents/*.md`
 *   3. `project`  — `<cwd>/.claude-drive/agents/*.md`
 *
 * When two scopes define the same agent name, later scope wins (project
 * overrides user overrides builtin), matching Claude Code's resolution order.
 */
import fs from "fs";
import path from "path";
import { getConfig } from "./config.js";
import { parseFrontmatter } from "./frontmatter.js";
import { agentsDir, expandUserHome } from "./paths.js";
import { logger } from "./logger.js";
import type { EffortLevel, OperatorRole, PermissionPreset } from "./operatorRegistry.js";

export type AgentDefinitionScope = "builtin" | "user" | "project";

export interface AgentDefinition {
  /** Agent name (required; unique per resolved scope). */
  name: string;
  /** Short human description. */
  description: string;
  /** Optional custom prompt (body of the .md file). */
  prompt?: string;
  /** SDK model string override. */
  model?: string;
  /** Allowed tools (claude-drive tool names). */
  tools?: string[];
  /** Permission preset maps to `PermissionPreset`. */
  preset?: PermissionPreset;
  /** Operator role for claude-drive's role templates. */
  role?: OperatorRole;
  /** Effort / thinking depth. */
  effort?: EffortLevel;
  /** Turn ceiling. */
  maxTurns?: number;
  /** Whether the operator should run detached by default. */
  background?: boolean;
  /** "worktree" = spawn with an isolated git worktree; "shared" = share cwd. */
  isolation?: "worktree" | "shared";
  /** Skill ids to pre-load. */
  skills?: string[];
  /** UI color hint. */
  color?: string;
  /** Where this definition was sourced from. */
  scope?: AgentDefinitionScope;
  /** Source file path (unset for builtins). */
  filePath?: string;
}

// ── Built-in registry ───────────────────────────────────────────────────────

class BuiltinAgentRegistry {
  private readonly defs = new Map<string, AgentDefinition>();

  register(def: AgentDefinition): void {
    this.defs.set(def.name, { ...def, scope: "builtin" });
  }

  clear(): void {
    this.defs.clear();
  }

  values(): IterableIterator<AgentDefinition> {
    return this.defs.values();
  }

  __resetForTests(): void {
    this.defs.clear();
  }
}

const builtinAgentRegistry = new BuiltinAgentRegistry();

export function registerBuiltinAgent(def: AgentDefinition): void {
  builtinAgentRegistry.register(def);
}

export function clearBuiltinAgents(): void {
  builtinAgentRegistry.clear();
}

export function __resetBuiltinAgentRegistryForTests(): void {
  builtinAgentRegistry.__resetForTests();
}

// ── File parsing ────────────────────────────────────────────────────────────

function parseAgentFile(content: string, filePath?: string, scope: AgentDefinitionScope = "user"): AgentDefinition | undefined {
  const { meta, body } = parseFrontmatter(content);
  const name = (meta.name as string | undefined)?.trim();
  const description = (meta.description as string | undefined)?.trim();
  if (!name || !description) return undefined;

  const tools = Array.isArray(meta.tools) ? (meta.tools as string[]) : undefined;
  const skills = Array.isArray(meta.skills) ? (meta.skills as string[]) : undefined;

  const parseBool = (v: unknown): boolean | undefined => {
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
    return undefined;
  };

  const parseNum = (v: unknown): number | undefined => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
    return undefined;
  };

  const def: AgentDefinition = {
    name,
    description,
    prompt: body.length > 0 ? body : undefined,
    model: meta.model as string | undefined,
    tools,
    preset: meta.preset as PermissionPreset | undefined,
    role: meta.role as OperatorRole | undefined,
    effort: meta.effort as EffortLevel | undefined,
    maxTurns: parseNum(meta.maxTurns),
    background: parseBool(meta.background),
    isolation: (meta.isolation as "worktree" | "shared" | undefined),
    skills,
    color: meta.color as string | undefined,
    scope,
    filePath,
  };
  return def;
}

function readDefsFromDir(dir: string, scope: AgentDefinitionScope): AgentDefinition[] {
  try {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    const out: AgentDefinition[] = [];
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(dir, f), "utf-8");
        const def = parseAgentFile(content, path.join(dir, f), scope);
        if (def) out.push(def);
      } catch (e) {
        logger.warn(`[agentDefinitionLoader] failed to load ${f}:`, e);
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface LoadOptions {
  projectDir?: string;
  userDir?: string;
}

export function loadAgentDefinitions(
  scopes: AgentDefinitionScope[] = ["builtin", "user", "project"],
  opts: LoadOptions = {},
): AgentDefinition[] {
  const byName = new Map<string, AgentDefinition>();

  for (const scope of scopes) {
    const defs: AgentDefinition[] = (() => {
      if (scope === "builtin") return [...builtinAgentRegistry.values()];
      if (scope === "user") {
        const override = opts.userDir ?? getConfig<string>("agents.directory");
        const dir = override ? expandUserHome(override) : agentsDir();
        return readDefsFromDir(dir, "user");
      }
      if (scope === "project") {
        const base = opts.projectDir ?? process.cwd();
        const dir = path.join(base, ".claude-drive", "agents");
        return readDefsFromDir(dir, "project");
      }
      return [];
    })();
    for (const def of defs) byName.set(def.name, def);
  }

  return [...byName.values()];
}

export function getAgentDefinition(name: string, opts: LoadOptions = {}): AgentDefinition | undefined {
  return loadAgentDefinitions(["builtin", "user", "project"], opts).find((d) => d.name === name);
}

/**
 * Translate an AgentDefinition into SpawnOptions-compatible fields + runtime
 * hints. Consumers pass these to `OperatorRegistry.spawn()` and/or `runOperator()`.
 */
export interface ResolvedAgentSpawnInputs {
  role?: OperatorRole;
  preset?: PermissionPreset;
  effort?: EffortLevel;
  executionMode?: "foreground" | "background";
  agentDefinitionName: string;
  maxTurns?: number;
  isolation?: "worktree" | "shared";
  prompt?: string;
}

export function toSpawnInputs(def: AgentDefinition): ResolvedAgentSpawnInputs {
  return {
    role: def.role,
    preset: def.preset,
    effort: def.effort,
    executionMode: def.background ? "background" : undefined,
    agentDefinitionName: def.name,
    maxTurns: def.maxTurns,
    isolation: def.isolation,
    prompt: def.prompt,
  };
}

/**
 * Merge an agent definition (if one matches `name`) into a partial SpawnOptions-like
 * object. Explicit caller-provided fields win over the definition's defaults.
 */
export function applyAgentDefinition<
  T extends {
    role?: OperatorRole;
    preset?: PermissionPreset;
    effort?: EffortLevel;
    executionMode?: "foreground" | "background";
    agentDefinitionName?: string;
  },
>(name: string | undefined, overrides: T, opts: LoadOptions = {}): { options: T; definition?: AgentDefinition } {
  if (!name) return { options: overrides };
  const def = getAgentDefinition(name, opts);
  if (!def) return { options: overrides };
  const inputs = toSpawnInputs(def);
  const merged: T = {
    ...overrides,
    role: overrides.role ?? inputs.role,
    preset: overrides.preset ?? inputs.preset,
    effort: overrides.effort ?? inputs.effort,
    executionMode: overrides.executionMode ?? inputs.executionMode,
    agentDefinitionName: overrides.agentDefinitionName ?? inputs.agentDefinitionName,
  };
  return { options: merged, definition: def };
}
