/**
 * verifier.ts — Spec-Test-Lint quality gate for claude-drive.
 * Runs configurable verification commands in an operator's worktree
 * after their task completes.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { getConfig } from "./config.js";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

export interface VerificationResult {
  passed: boolean;
  results: CommandResult[];
  duration: number;
}

export interface CommandResult {
  command: string;
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Run verification commands in the given working directory.
 * Returns structured results for each command.
 */
export async function runVerification(cwd: string): Promise<VerificationResult> {
  const commands = getConfig<string[]>("verification.commands") ?? [];
  if (commands.length === 0) {
    return { passed: true, results: [], duration: 0 };
  }

  const timeoutMs = getConfig<number>("verification.timeoutMs") ?? 120_000;
  const start = Date.now();
  const results: CommandResult[] = [];
  let allPassed = true;

  for (const cmd of commands) {
    const parts = cmd.split(/\s+/);
    const [executable, ...args] = parts;
    try {
      const { stdout, stderr } = await execFileAsync(executable, args, {
        cwd,
        timeout: timeoutMs,
        shell: true,
      });
      results.push({ command: cmd, passed: true, stdout, stderr, exitCode: 0 });
    } catch (err: unknown) {
      allPassed = false;
      const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
      results.push({
        command: cmd,
        passed: false,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? "",
        exitCode: e.code ?? 1,
      });
      log("warn", "verifier", `Verification failed: ${cmd}`, { stderr: (e.stderr ?? "").slice(0, 500) });
    }
  }

  return { passed: allPassed, results, duration: Date.now() - start };
}

/**
 * Format verification results into a prompt for the operator to fix issues.
 */
export function formatVerificationErrors(result: VerificationResult): string {
  const failures = result.results.filter((r) => !r.passed);
  if (failures.length === 0) return "";

  const lines = ["Verification failed. Fix these issues:\n"];
  for (const f of failures) {
    lines.push(`## ${f.command} (exit code ${f.exitCode})`);
    if (f.stderr) lines.push("```\n" + f.stderr.slice(0, 1000) + "\n```");
    if (f.stdout) lines.push("stdout:\n```\n" + f.stdout.slice(0, 500) + "\n```");
  }
  return lines.join("\n");
}
