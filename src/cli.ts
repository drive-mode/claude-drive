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
import os from "os";
import fs from "fs";
import path from "path";
import { Command } from "commander";
import { createDriveModeManager } from "./driveMode.js";
import { OperatorRegistry } from "./operatorRegistry.js";
import { runOperator } from "./operatorManager.js";
import { speak } from "./tts.js";
import { printStatus, logActivity, agentOutput } from "./agentOutput.js";
import { route } from "./router.js";
import { saveConfig, getConfig } from "./config.js";

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

    // Check for stale port file
    const { readPortFile, getPortFilePath } = await import("./mcpServer.js");
    const existingPort = readPortFile();
    if (existingPort !== undefined) {
      try {
        const res = await fetch(`http://localhost:${existingPort}/health`);
        if (res.ok) {
          console.log(`[claude-drive] Already running on port ${existingPort}`);
          process.exit(0);
        }
      } catch {
        // Unreachable — stale port file, delete it
        const fsSync = await import("fs");
        try { fsSync.unlinkSync(getPortFilePath()); } catch { /* already gone */ }
        console.log("[claude-drive] Removed stale port file.");
      }
    }

    driveMode.setActive(true);

    if (opts.tui) {
      agentOutput.setRenderMode("tui");
      const { startTui } = await import("./tui.js");
      startTui({ registry, driveMode, agentOutput });
    } else {
      console.log(`[claude-drive] Starting MCP server on port ${port}...`);
      printStatus(true, driveMode.subMode);
    }

    // Initialize new services
    const workspaceRoot = process.cwd();
    const { PersistentMemory } = await import("./persistentMemory.js");
    const { SessionMemory } = await import("./sessionMemory.js");
    const persistentMemory = new PersistentMemory(workspaceRoot);
    const sessionMemory = new SessionMemory();

    // Initialize sync orchestration if in a git repo
    let syncCoordinator: import("./stateSyncCoordinator.js").StateSyncCoordinator | undefined;
    let integrationQueue: import("./integrationQueue.js").IntegrationQueue | undefined;
    let gitService: import("./gitService.js").GitService | undefined;
    let worktreeManager: import("./worktreeManager.js").WorktreeManager | undefined;
    try {
      const { execSync } = await import("child_process");
      execSync("git rev-parse --is-inside-work-tree", { cwd: workspaceRoot, stdio: "ignore" });
      const { GitService } = await import("./gitService.js");
      const { WorktreeManager } = await import("./worktreeManager.js");
      const { StateSyncCoordinator } = await import("./stateSyncCoordinator.js");
      const { IntegrationQueue } = await import("./integrationQueue.js");
      gitService = new GitService(workspaceRoot);
      worktreeManager = new WorktreeManager(gitService, workspaceRoot);
      syncCoordinator = new StateSyncCoordinator(gitService, registry, worktreeManager, workspaceRoot);
      integrationQueue = new IntegrationQueue(gitService, syncCoordinator, registry);
      if (!opts.tui) console.log("[claude-drive] Sync orchestration enabled (git repo detected).");
    } catch {
      if (!opts.tui) console.log("[claude-drive] Sync orchestration disabled (not a git repo).");
    }

    // Initialize CommsAgent
    const { CommsAgent } = await import("./commsAgent.js");
    const commsAgent = new CommsAgent();
    commsAgent.onFlush((summary) => {
      logActivity("comms", summary);
      if (getConfig<boolean>("tts.enabled")) {
        speak(summary);
      }
    });

    // Lazy-import MCP server to keep startup fast when not needed
    const { startMcpServer } = await import("./mcpServer.js");
    const { port: boundPort } = await startMcpServer({
      port, registry, driveMode,
      persistentMemory, sessionMemory,
      syncCoordinator, integrationQueue,
      gitService, worktreeManager,
      commsAgent,
      workspaceRoot,
    });

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

    // Keep process alive
    process.stdin.resume();
    process.on("SIGINT", () => {
      driveMode.setActive(false);
      commsAgent.dispose();
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

// ── stop ──────────────────────────────────────────────────────────────────

program
  .command("stop")
  .description("Stop the running claude-drive daemon")
  .action(async () => {
    const { readPortFile, getPortFilePath } = await import("./mcpServer.js");
    const port = readPortFile();
    if (port === undefined) {
      console.log("[claude-drive] Not running (no port file found).");
      process.exit(0);
    }
    try {
      await fetch(`http://localhost:${port}/mcp`, { method: "DELETE" });
    } catch {
      // Server already gone
    }
    const fsSync = await import("fs");
    try { fsSync.unlinkSync(getPortFilePath()); } catch { /* already gone */ }
    console.log("[claude-drive] Stopped.");
  });

// ── install ───────────────────────────────────────────────────────────────

program
  .command("install")
  .description("Register claude-drive as an MCP server in Claude Desktop and ~/.claude/settings.json")
  .action(async () => {
    const { readPortFile } = await import("./mcpServer.js");
    const port = readPortFile() ?? getConfig<number>("mcp.port") ?? 7891;
    const entry = { url: `http://localhost:${port}/mcp` };
    const targets: string[] = [
      path.join(os.homedir(), ".claude", "settings.json"),
    ];
    if (process.env.APPDATA) {
      targets.push(path.join(process.env.APPDATA, "Claude", "claude_desktop_config.json"));
    }
    for (const filePath of targets) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch { /* file missing or unparseable — start fresh */ }
      const mcpServers = (existing.mcpServers as Record<string, unknown>) ?? {};
      mcpServers["claude-drive"] = entry;
      existing.mcpServers = mcpServers;
      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n");
      console.log(`[claude-drive] Written: ${filePath}`);
    }
  });

// ── main ──────────────────────────────────────────────────────────────────

// Show status line on registry changes
registry.onDidChange(() => {
  const fg = registry.getForeground();
  const bg = registry.getActive().filter((o) => o.status === "background").length;
  printStatus(driveMode.active, driveMode.subMode, fg?.name, bg);
});

program.parse(process.argv);
