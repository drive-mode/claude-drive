import fs from "fs";
import os from "os";
import path from "path";
import {
  loadAgentDefinitions,
  getAgentDefinition,
  applyAgentDefinition,
  registerBuiltinAgent,
  clearBuiltinAgents,
} from "../src/agentDefinitionLoader.js";
import { registerBuiltins, BUILTIN_AGENTS } from "../src/builtinAgents.js";

function mkdirTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cd-agents-"));
}

function writeAgent(dir: string, filename: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body, "utf-8");
}

beforeEach(() => {
  clearBuiltinAgents();
});

describe("agentDefinitionLoader", () => {
  test("loads built-in definitions from registry", () => {
    registerBuiltins();
    const defs = loadAgentDefinitions(["builtin"]);
    expect(defs.length).toBe(BUILTIN_AGENTS.length);
    expect(defs.find((d) => d.name === "explore")).toBeDefined();
  });

  test("loads .md definitions from user scope", () => {
    const userDir = mkdirTmp();
    writeAgent(userDir, "custom.md", [
      "---",
      "name: custom",
      "description: A custom agent",
      "role: researcher",
      "preset: readonly",
      "background: true",
      "effort: low",
      "---",
      "Body prompt.",
    ].join("\n"));

    const defs = loadAgentDefinitions(["user"], { userDir });
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      name: "custom",
      description: "A custom agent",
      role: "researcher",
      preset: "readonly",
      background: true,
      effort: "low",
      prompt: "Body prompt.",
      scope: "user",
    });
  });

  test("project scope overrides user scope for same name", () => {
    const userDir = mkdirTmp();
    const projectDir = mkdirTmp();
    writeAgent(userDir, "dup.md", "---\nname: dup\ndescription: user version\n---\n");
    writeAgent(path.join(projectDir, ".claude-drive", "agents"), "dup.md", "---\nname: dup\ndescription: project version\n---\n");

    const defs = loadAgentDefinitions(["user", "project"], { userDir, projectDir });
    expect(defs).toHaveLength(1);
    expect(defs[0].description).toBe("project version");
    expect(defs[0].scope).toBe("project");
  });

  test("user scope overrides builtin scope", () => {
    registerBuiltinAgent({ name: "shared", description: "builtin", scope: "builtin" });
    const userDir = mkdirTmp();
    writeAgent(userDir, "shared.md", "---\nname: shared\ndescription: user override\n---\n");

    const def = getAgentDefinition("shared", { userDir });
    expect(def?.description).toBe("user override");
    expect(def?.scope).toBe("user");
  });

  test("skips files with missing required frontmatter", () => {
    const userDir = mkdirTmp();
    writeAgent(userDir, "incomplete.md", "---\nname: incomplete\n---\nno description");
    const defs = loadAgentDefinitions(["user"], { userDir });
    expect(defs).toHaveLength(0);
  });

  test("applyAgentDefinition merges defaults without clobbering explicit overrides", () => {
    registerBuiltinAgent({
      name: "seed",
      description: "a seed agent",
      role: "researcher",
      preset: "readonly",
      effort: "low",
      background: true,
      scope: "builtin",
    });
    const merged = applyAgentDefinition("seed", {
      // Caller explicitly forces standard; should NOT be overridden by agent def.
      preset: "standard" as const,
    });
    expect(merged.options.preset).toBe("standard");
    expect(merged.options.role).toBe("researcher");
    expect(merged.options.effort).toBe("low");
    expect(merged.options.executionMode).toBe("background");
    expect(merged.options.agentDefinitionName).toBe("seed");
  });

  test("applyAgentDefinition returns overrides unchanged when name does not match", () => {
    const merged = applyAgentDefinition("no-such-agent", { role: "tester" as const });
    expect(merged.options.role).toBe("tester");
    expect(merged.definition).toBeUndefined();
  });
});
