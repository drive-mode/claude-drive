/**
 * tests/paths.test.ts — verifies the path resolution seam.
 */
import os from "os";
import path from "path";

function reloadPaths(): typeof import("../src/paths.js") {
  // jest ESM: use dynamic import with cache-busting query string to force
  // re-evaluation so each case sees its own env.
  const url = new URL("../src/paths.ts", import.meta.url).href;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(url) as typeof import("../src/paths.js");
}

describe("paths", () => {
  const ORIGINAL_HOME = process.env.CLAUDE_DRIVE_HOME;

  afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.CLAUDE_DRIVE_HOME;
    else process.env.CLAUDE_DRIVE_HOME = ORIGINAL_HOME;
  });

  test("home() defaults to $HOME/.claude-drive", async () => {
    delete process.env.CLAUDE_DRIVE_HOME;
    const { home } = await import("../src/paths.js");
    expect(home()).toBe(path.join(os.homedir(), ".claude-drive"));
  });

  test("home() honours CLAUDE_DRIVE_HOME env absolute path", async () => {
    process.env.CLAUDE_DRIVE_HOME = "/tmp/fake-cd-home";
    const { home } = await import("../src/paths.js");
    expect(home()).toBe("/tmp/fake-cd-home");
  });

  test("home() expands ~ and ~/ in CLAUDE_DRIVE_HOME", async () => {
    process.env.CLAUDE_DRIVE_HOME = "~";
    const { home: home1 } = await import("../src/paths.js");
    expect(home1()).toBe(os.homedir());

    process.env.CLAUDE_DRIVE_HOME = "~/custom-cd";
    const { home: home2 } = await import("../src/paths.js");
    expect(home2()).toBe(path.join(os.homedir(), "custom-cd"));
  });

  test("derived paths compose from home()", async () => {
    process.env.CLAUDE_DRIVE_HOME = "/tmp/xyz";
    const p = await import("../src/paths.js");
    expect(p.configFile()).toBe("/tmp/xyz/config.json");
    expect(p.portFile()).toBe("/tmp/xyz/port");
    expect(p.statusFile()).toBe("/tmp/xyz/status.json");
    expect(p.skillsDir()).toBe("/tmp/xyz/skills");
    expect(p.agentsDir()).toBe("/tmp/xyz/agents");
    expect(p.hooksDir()).toBe("/tmp/xyz/hooks");
    expect(p.sessionsDir()).toBe("/tmp/xyz/sessions");
    expect(p.subagentsBaseDir()).toBe("/tmp/xyz/subagents");
    expect(p.subagentDir("op-1")).toBe("/tmp/xyz/subagents/op-1");
    expect(p.statuslineScriptPath()).toBe("/tmp/xyz/statusline.sh");
  });

  test("expandUserHome expands ~ prefixes only", async () => {
    const { expandUserHome } = await import("../src/paths.js");
    expect(expandUserHome("~")).toBe(os.homedir());
    expect(expandUserHome("~/foo")).toBe(path.join(os.homedir(), "foo"));
    expect(expandUserHome("/absolute/path")).toBe("/absolute/path");
    expect(expandUserHome("")).toBe("");
  });
});

// The dynamic import + process.env mutation pattern relies on jest's module
// cache. Since paths() reads env on *each call* (not at module load), we can
// simply mutate env between calls without reloading the module.
void reloadPaths; // keep helper symbol for future use
