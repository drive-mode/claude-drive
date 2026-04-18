/**
 * builtinAgents.ts — First-party agent definitions baked into claude-drive.
 *
 * These are equivalent to agent files under `~/.claude-drive/agents/` but never
 * touch disk. User/project files with the same `name` override these.
 */
import type { AgentDefinition } from "./agentDefinitionLoader.js";
import { registerBuiltinAgent, clearBuiltinAgents } from "./agentDefinitionLoader.js";

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: "explore",
    description: "Read-only codebase researcher for quick exploration tasks.",
    role: "researcher",
    preset: "readonly",
    effort: "low",
    background: false,
    isolation: "shared",
    tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
    scope: "builtin",
  },
  {
    name: "bash",
    description: "Shell command isolation operator. Runs bash/grep/read only.",
    role: "implementer",
    preset: "standard",
    effort: "low",
    background: true,
    isolation: "worktree",
    tools: ["Bash", "Read", "Grep", "Glob"],
    scope: "builtin",
  },
  {
    name: "reviewer",
    description: "Read-only code reviewer. Flags bugs, risks, and test gaps.",
    role: "reviewer",
    preset: "readonly",
    effort: "medium",
    background: false,
    isolation: "shared",
    scope: "builtin",
  },
];

/** Idempotent registration — safe to call on every startup. */
export function registerBuiltins(): void {
  clearBuiltinAgents();
  for (const def of BUILTIN_AGENTS) {
    registerBuiltinAgent(def);
  }
}
