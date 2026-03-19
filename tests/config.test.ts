import { getConfig, setFlag } from "../src/config.js";

describe("getConfig()", () => {
  it("returns boolean default for tts.enabled", () => {
    expect(getConfig("tts.enabled")).toBe(true);
  });

  it("returns numeric default for mcp.port", () => {
    expect(getConfig("mcp.port")).toBe(7891);
  });

  it("returns string default for tts.backend", () => {
    expect(getConfig("tts.backend")).toBe("edgeTts");
  });

  it("returns array default for operators.namePool", () => {
    const pool = getConfig<string[]>("operators.namePool");
    expect(Array.isArray(pool)).toBe(true);
    expect(pool.length).toBeGreaterThan(0);
  });

  it("returns undefined for unknown key", () => {
    expect(getConfig("does.not.exist")).toBeUndefined();
  });

  it("env var CLAUDE_DRIVE_TTS_BACKEND overrides default", () => {
    process.env.CLAUDE_DRIVE_TTS_BACKEND = "piper";
    expect(getConfig("tts.backend")).toBe("piper");
    delete process.env.CLAUDE_DRIVE_TTS_BACKEND;
  });

  it("env var override is removed after delete", () => {
    delete process.env.CLAUDE_DRIVE_TTS_BACKEND;
    expect(getConfig("tts.backend")).toBe("edgeTts");
  });
});

describe("setFlag()", () => {
  afterEach(() => {
    // Reset the flag we set
    setFlag("tts.backend", undefined);
  });

  it("runtime flag overrides default", () => {
    setFlag("tts.backend", "say");
    expect(getConfig("tts.backend")).toBe("say");
  });

  it("runtime flag overrides env var", () => {
    process.env.CLAUDE_DRIVE_TTS_BACKEND = "piper";
    setFlag("tts.backend", "say");
    expect(getConfig("tts.backend")).toBe("say");
    delete process.env.CLAUDE_DRIVE_TTS_BACKEND;
  });
});
