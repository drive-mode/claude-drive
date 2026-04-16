import { parseFrontmatter, resolveTemplate } from "../src/frontmatter.js";

describe("parseFrontmatter", () => {
  test("returns empty meta for content without frontmatter", () => {
    const { meta, body } = parseFrontmatter("hello world");
    expect(meta).toEqual({});
    expect(body).toBe("hello world");
  });

  test("parses flat key/value pairs", () => {
    const src = `---\nname: demo\ndescription: Does a thing\n---\nbody text`;
    const { meta, body } = parseFrontmatter(src);
    expect(meta.name).toBe("demo");
    expect(meta.description).toBe("Does a thing");
    expect(body).toBe("body text");
  });

  test("coerces booleans", () => {
    const src = `---\nenabled: true\nbackground: false\n---\n`;
    const { meta } = parseFrontmatter(src);
    expect(meta.enabled).toBe(true);
    expect(meta.background).toBe(false);
  });

  test("parses inline arrays", () => {
    const src = `---\ntags: [a, b, "c d"]\n---\n`;
    const { meta } = parseFrontmatter(src);
    expect(meta.tags).toEqual(["a", "b", "c d"]);
  });

  test("parses block arrays of objects (parameters)", () => {
    const src = `---\nname: s\ndescription: d\nparameters:\n  - name: foo\n    description: Foo\n    required: true\n  - name: bar\n    description: Bar\n---\n`;
    const { meta } = parseFrontmatter(src);
    expect(Array.isArray(meta.parameters)).toBe(true);
    const params = meta.parameters as Array<Record<string, unknown>>;
    expect(params).toHaveLength(2);
    expect(params[0]).toEqual({ name: "foo", description: "Foo", required: true });
    expect(params[1]).toEqual({ name: "bar", description: "Bar" });
  });
});

describe("resolveTemplate", () => {
  test("replaces {{name}} placeholders", () => {
    expect(resolveTemplate("hi {{who}}", { who: "world" })).toBe("hi world");
  });

  test("leaves unknown placeholders verbatim", () => {
    expect(resolveTemplate("hi {{who}} and {{what}}", { who: "a" })).toBe("hi a and {{what}}");
  });
});
