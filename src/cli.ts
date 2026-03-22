#!/usr/bin/env node
/**
 * cli.ts — Entry point for claude-drive CLI.
 * Usage:
 *   claude-drive start                     # Start MCP server daemon
 *   claude-drive run "task"                # Run one-shot task
 *   claude-drive operator spawn [name]     # Spawn a named operator
 *   claude-drive operator list             # List active operators
 *   claude-drive operator switch <name>    # Switch foreground operator
 *   claude-drive operator dismiss <name>   # Dismiss an operator
 *   claude-drive mode set <mode>           # Set drive sub-mode
 *   claude-drive tts "text"                # Speak text via TTS
 *   claude-drive config set <key> <value>  # Set a config value
 */
import { Command } from "commander";
import { createDriveModeManager } from "./driveMode.js";
import { OperatorRegistry } from "./operatorRegistry.js";
import { runOperator } from "./operatorManager.js";
import { speak } from "./tts.js";
import { printStatus, logActivity, agentOutput } from "./agentOutput.js";
import { route } from "./router.js";
import { saveConfig, getConfig } from "./config.js";
import { writeStatusFile, deleteStatusFile } from "./statusFile.js";

const program = new Command();
const registry = new OperatorRegistry();
const driveMode = createDriveModeManager();

program
  .name("claude-drive")
  .description("Voice-first multi-operator pair programming for Claude Code CLI")
  .version("0.1.0");

// ── start ──────────────────────────────────────────────────────────────────

program
  .command("start")
  .description("Start the claude-drive MCP server")
  .option("-p, --port <number>", "MCP server port", String(getConfig<number>("mcp.port") ?? 7891))
  .option("--tui", "Render ink two-pane TUI instead of plain terminal output")
  .action(async (opts: { port: string; tui?: boolean }) => {
    const port = parseInt(opts.port, 10);
    driveMode.setActive(true);

    if (opts.tui) {
      agentOutput.setRenderMode("tui");
      const { startTui } = await import("./tui.js");
      startTui({ registry, driveMode, agentOutput });
    } else {
      console.log(`[claude-drive] Starting MCP server on port ${port}...`);
      printStatus(true, driveMode.subMode);
    }

    // Lazy-import MCP server to keep startup fast when not needed
    const { startMcpServer, getPortFilePath } = await import("./mcpServer.js");
    const { port: boundPort } = await startMcpServer({ port, registry, driveMode });

    if (!opts.tui) {
      console.log(`[claude-drive] MCP URL: http://localhost:${boundPort}/mcp`);
      console.log(`[claude-drive] Port file: ${getPortFilePath()}`);
      console.log(`[claude-drive] Add to ~/.claude/settings.json:`);
      console.log(JSON.stringify({
        mcpServers: {
          "claude-drive": {
            url: `http://localhost:${boundPort}/mcp`,
          },
        },
      }, null, 2));
    }

    // Flush status.json on every state change for the status line script
    function flushStatus(): void {
      writeStatusFile({
        active: driveMode.active,
        subMode: driveMode.subMode,
        foregroundOperator: registry.getForeground()?.name ?? null,
        operators: registry.getActive().map((o) => ({
          name: o.name, status: o.status, role: o.role, task: o.task ?? "",
        })),
        updatedAt: Date.now(),
      });
    }
    registry.onDidChange(flushStatus);
    driveMode.on("change", flushStatus);
    flushStatus(); // initial write

    // Keep process alive
    process.stdin.resume();
    process.on("SIGINT", () => {
      driveMode.setActive(false);
      deleteStatusFile();
      if (!opts.tui) console.log("\n[claude-drive] Shutting down.");
      process.exit(0);
    });
  });

// ── run ───────────────────────────────────────────────────────────────────

program
  .command("run <task>")
  .description("Run a one-shot task with the default operator")
  .option("-n, --name <name>", "Operator name")
  .option("--role <role>", "Operator role (implementer|reviewer|tester|researcher|planner)")
  .option("--preset <preset>", "Permission preset (readonly|standard|full)")
  .action(async (task: string, opts: { name?: string; role?: string; preset?: string }) => {
    const decision = route({ prompt: task, driveSubMode: driveMode.subMode });
    driveMode.setSubMode(decision.mode as never);
    logActivity("router", decision.reason);
    const op = registry.spawn(opts.name, task, {
      role: opts.role as never,
      preset: opts.preset as never,
    });
    await runOperator(op, task, { allOperators: registry.getActive() });
  });

// ── serve-stdio ────────────────────────────────────────────────────────────

program
  .command("serve-stdio")
  .description("Run MCP server over stdin/stdout (for Claude Desktop plugin)")
  .action(async () => {
    driveMode.setActive(true);
    const { startMcpServerStdio } = await import("./mcpServer.js");
    await startMcpServerStdio({ registry, driveMode });
  });

// ── operator ──────────────────────────────────────────────────────────────

const operatorCmd = program.command("operator").description("Manage operators");

operatorCmd
  .command("spawn [name]")
  .description("Spawn a new operator")
  .option("--task <task>", "Initial task")
  .option("--role <role>", "Role")
  .option("--preset <preset>", "Permission preset")
  .action((name: string | undefined, opts: { task?: string; role?: string; preset?: string }) => {
    const op = registry.spawn(name, opts.task ?? "", {
      role: opts.role as never,
      preset: opts.preset as never,
    });
    console.log(`[claude-drive] Spawned operator: ${op.name} (${op.permissionPreset})`);
    printStatus(driveMode.active, driveMode.subMode, op.name, registry.getActive().length - 1);
  });

operatorCmd
  .command("list")
  .description("List active operators")
  .action(() => {
    const ops = registry.getActive();
    if (ops.length === 0) { console.log("No active operators."); return; }
    for (const op of ops) {
      const fg = registry.getForeground()?.id === op.id ? " [fg]" : "";
      console.log(`  ${op.name}${fg}  ${op.permissionPreset}  ${op.status}  ${op.task || "(no task)"}`);
    }
  });

operatorCmd
  .command("switch <name>")
  .description("Switch foreground operator")
  .action((name: string) => {
    const op = registry.switchTo(name);
    if (!op) { console.error(`[claude-drive] Operator not found: ${name}`); return; }
    console.log(`[claude-drive] Switched to ${op.name}`);
    printStatus(driveMode.active, driveMode.subMode, op.name);
  });

operatorCmd
  .command("dismiss <name>")
  .description("Dismiss an operator")
  .action((name: string) => {
    const ok = registry.dismiss(name);
    console.log(ok ? `[claude-drive] Dismissed ${name}` : `[claude-drive] Not found: ${name}`);
  });

// ── mode ──────────────────────────────────────────────────────────────────

const modeCmd = program.command("mode").description("Drive mode control");

modeCmd
  .command("set <mode>")
  .description("Set drive sub-mode (plan|agent|ask|debug|off)")
  .action((mode: string) => {
    driveMode.setSubMode(mode as never);
    console.log(`[claude-drive] Mode: ${mode}`);
    printStatus(driveMode.active, mode, registry.getForeground()?.name);
  });

modeCmd
  .command("status")
  .description("Show current drive state")
  .action(() => {
    printStatus(driveMode.active, driveMode.subMode, registry.getForeground()?.name, registry.getActive().length - 1);
  });

// ── tts ───────────────────────────────────────────────────────────────────

program
  .command("tts <text>")
  .description("Speak text via TTS")
  .action((text: string) => { speak(text); });

// ── config ────────────────────────────────────────────────────────────────

const configCmd = program.command("config").description("Manage configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a config value (e.g. tts.backend edgeTts)")
  .action((key: string, value: string) => {
    // Try to parse as JSON for booleans/numbers/arrays
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* keep as string */ }
    saveConfig(key, parsed);
    console.log(`[claude-drive] Config set: ${key} = ${JSON.stringify(parsed)}`);
  });

configCmd
  .command("get <key>")
  .description("Get a config value")
  .action((key: string) => {
    console.log(JSON.stringify(getConfig(key)));
  });

// ── port ──────────────────────────────────────────────────────────────────

program
  .command("port")
  .description("Print the live MCP server URL (reads ~/.claude-drive/port)")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const { readPortFile } = await import("./mcpServer.js");
    const port = readPortFile();
    if (port === undefined) {
      console.error("[claude-drive] Server is not running (no port file found).");
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify({ url: `http://localhost:${port}/mcp`, port }));
    } else {
      console.log(`http://localhost:${port}/mcp`);
    }
  });

// ── statusline ───────────────────────────────────────────────────────

const statuslineCmd = program.command("statusline").description("Claude Code status line integration");

statuslineCmd
  .command("install")
  .description("Install claude-drive status line into Claude Code settings")
  .action(async () => {
    const { installStatusLine } = await import("./statusLine.js");
    const result = installStatusLine();
    console.log(`[claude-drive] Status line script: ${result.scriptPath}`);
    if (result.settingsPatched) {
      console.log("[claude-drive] Updated ~/.claude/settings.json");
    }
    console.log("[claude-drive] Restart Claude Code to activate.");
  });

statuslineCmd
  .command("uninstall")
  .description("Remove claude-drive status line from Claude Code settings")
  .action(async () => {
    const { uninstallStatusLine } = await import("./statusLine.js");
    const result = uninstallStatusLine();
    if (result.scriptRemoved) console.log("[claude-drive] Removed status line script.");
    if (result.settingsPatched) console.log("[claude-drive] Removed statusLine from ~/.claude/settings.json");
    if (!result.scriptRemoved && !result.settingsPatched) console.log("[claude-drive] Nothing to uninstall.");
  });

statuslineCmd
  .command("preview")
  .description("Preview the generated status line script")
  .action(async () => {
    const { generateStatusLineScript } = await import("./statusLine.js");
    console.log(generateStatusLineScript());
  });

// ── main ──────────────────────────────────────────────────────────────────

// Show status line on registry changes
registry.onDidChange(() => {
  const fg = registry.getForeground();
  const bg = registry.getActive().filter((o) => o.status === "background").length;
  printStatus(driveMode.active, driveMode.subMode, fg?.name, bg);
});

program.parse(process.argv);
