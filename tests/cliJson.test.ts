/**
 * tests/cliJson.test.ts — smoke-tests the CLI --json paths.
 *
 * The CLI spawns as a child process, so these tests invoke `node out/cli.js`
 * and assert that stdout is valid JSON. That guarantees no stderr chatter
 * leaks into stdout.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const CLI = path.resolve(process.cwd(), "out", "cli.js");
const HAS_CLI = fs.existsSync(CLI);

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_DRIVE_HOME: "/tmp/cd-cli-test-home" },
    });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof err.stdout === "string" ? err.stdout : err.stdout?.toString() ?? "",
      stderr: typeof err.stderr === "string" ? err.stderr : err.stderr?.toString() ?? "",
      status: err.status ?? null,
    };
  }
}

(HAS_CLI ? describe : describe.skip)("CLI --json paths", () => {
  test("agent list --json emits a valid JSON array", () => {
    const { stdout } = runCli(["agent", "list", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    // 3 built-ins are registered at startup.
    expect(parsed.length).toBeGreaterThanOrEqual(3);
    const names = parsed.map((d: { name: string }) => d.name).sort();
    expect(names).toEqual(expect.arrayContaining(["bash", "explore", "reviewer"]));
  });

  test("operator list --json emits an array (empty in a fresh process)", () => {
    const { stdout } = runCli(["operator", "list", "--json"]);
    expect(Array.isArray(JSON.parse(stdout))).toBe(true);
  });

  test("mode status --json emits an object with state keys", () => {
    const { stdout } = runCli(["mode", "status", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("active");
    expect(parsed).toHaveProperty("subMode");
    expect(parsed).toHaveProperty("foregroundOperator");
    expect(parsed).toHaveProperty("activeCount");
  });

  test("memory stats --json emits stats shape", () => {
    const { stdout } = runCli(["memory", "stats", "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("total");
    expect(parsed).toHaveProperty("byKind");
    expect(parsed).toHaveProperty("byOperator");
  });

  test("session list --json emits an array", () => {
    const { stdout } = runCli(["session", "list", "--json"]);
    expect(Array.isArray(JSON.parse(stdout))).toBe(true);
  });
});
