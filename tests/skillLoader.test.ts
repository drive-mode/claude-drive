import { SkillRegistry, resolveTemplate } from "../src/skillLoader.js";

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  test("register and get skill", () => {
    registry.register({
      name: "test-skill",
      description: "A test skill",
      prompt: "Do the thing",
    });

    const skill = registry.get("test-skill");
    expect(skill).toBeDefined();
    expect(skill!.name).toBe("test-skill");
    expect(skill!.prompt).toBe("Do the thing");
  });

  test("list returns all skills", () => {
    registry.register({ name: "a", description: "A", prompt: "pa" });
    registry.register({ name: "b", description: "B", prompt: "pb" });

    const skills = registry.list();
    expect(skills.length).toBe(2);
  });

  test("resolve with no parameters", () => {
    registry.register({
      name: "simple",
      description: "Simple",
      prompt: "Just do it",
    });

    const result = registry.resolve("simple");
    expect(result).toBe("Just do it");
  });

  test("resolve with parameters", () => {
    registry.register({
      name: "review",
      description: "Code review",
      prompt: "Review {{files}} focusing on {{focus}}",
      parameters: [
        { name: "files", description: "Files", required: true },
        { name: "focus", description: "Focus", default: "correctness" },
      ],
    });

    const result = registry.resolve("review", { files: "src/*.ts" });
    expect(result).toBe("Review src/*.ts focusing on correctness");
  });

  test("resolve with all params provided", () => {
    registry.register({
      name: "review",
      description: "Code review",
      prompt: "Review {{files}} focusing on {{focus}}",
      parameters: [
        { name: "files", description: "Files", required: true },
        { name: "focus", description: "Focus", default: "correctness" },
      ],
    });

    const result = registry.resolve("review", { files: "src/*.ts", focus: "security" });
    expect(result).toBe("Review src/*.ts focusing on security");
  });

  test("resolve throws on missing required parameter", () => {
    registry.register({
      name: "needs-param",
      description: "Needs param",
      prompt: "Do {{thing}}",
      parameters: [{ name: "thing", description: "The thing", required: true }],
    });

    expect(() => registry.resolve("needs-param")).toThrow("Missing required parameter: thing");
  });

  test("resolve returns undefined for unknown skill", () => {
    const result = registry.resolve("nonexistent");
    expect(result).toBeUndefined();
  });

  test("get returns undefined for unknown skill", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });
});

describe("resolveTemplate", () => {
  test("replaces template variables", () => {
    expect(resolveTemplate("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  test("leaves unresolved variables as-is", () => {
    expect(resolveTemplate("Hello {{name}}", {})).toBe("Hello {{name}}");
  });

  test("replaces multiple occurrences", () => {
    expect(resolveTemplate("{{a}} + {{b}} = {{a}}", { a: "1", b: "2" })).toBe("1 + 2 = 1");
  });
});
