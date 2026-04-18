import { jest } from "@jest/globals";
import { validateConfig, validateConfigValue, ConfigSchemas } from "../src/configSchema.js";
import { saveConfig, getConfig } from "../src/config.js";

describe("configSchema", () => {
  test("registers schemas for every documented key group", () => {
    // Sanity: known prefixes all have at least one schema.
    const keys = Object.keys(ConfigSchemas);
    const prefixes = ["tts", "operators", "operator", "bestOfN", "agents", "memory", "log", "mcp", "agentScreen", "drive", "voice", "privacy", "approvalGates", "statusLine", "router", "hooks", "skills", "sessions", "dream"];
    for (const p of prefixes) {
      expect(keys.some((k) => k.startsWith(p + "."))).toBe(true);
    }
  });

  test("validateConfigValue accepts in-range values", () => {
    expect(validateConfigValue("mcp.port", 8080)).toEqual({ ok: true, value: 8080 });
    expect(validateConfigValue("log.level", "debug")).toEqual({ ok: true, value: "debug" });
    expect(validateConfigValue("operator.defaultEffort", "high")).toEqual({ ok: true, value: "high" });
  });

  test("validateConfigValue rejects out-of-range values with a message", () => {
    const r1 = validateConfigValue("mcp.port", -1);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.message.length).toBeGreaterThan(0);

    const r2 = validateConfigValue("log.level", "SPAM");
    expect(r2.ok).toBe(false);

    const r3 = validateConfigValue("tts.volume", 7);
    expect(r3.ok).toBe(false); // must be 0..1
  });

  test("unknown keys pass through unchanged", () => {
    expect(validateConfigValue("plugin.custom.foo", { any: "thing" })).toEqual({
      ok: true,
      value: { any: "thing" },
    });
  });

  test("validateConfig reports errors and parsed values separately", () => {
    const result = validateConfig({
      "mcp.port": 9000,
      "log.level": "bogus",
      "tts.backend": "edgeTts",
      "tts.volume": 10,
      "plugin.foo": "bar",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.key).sort()).toEqual(["log.level", "tts.volume"]);
    expect(result.parsed["mcp.port"]).toBe(9000);
    expect(result.parsed["tts.backend"]).toBe("edgeTts");
    expect(result.unknownKeys).toEqual(["plugin.foo"]);
  });

  test("saveConfig rejects invalid values (they are not persisted)", () => {
    const previous = getConfig<number>("mcp.port");
    const spy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      saveConfig("mcp.port", "not-a-number");
    } finally {
      spy.mockRestore();
    }
    expect(getConfig<number>("mcp.port")).toBe(previous);
  });
});
