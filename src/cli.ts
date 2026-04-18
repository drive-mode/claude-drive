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
import { createDriveModeManager, isSubMode, type DriveSubMode } from "./driveMode.js";
import { OperatorRegistry, parseRole, parsePreset } from "./operatorRegistry.js";
import { runOperator } from "./operatorManager.js";
import { speak } from "./tts.js";
import { printStatus, logActivity, agentOutput } from "./agentOutput.js";
import { route } from "./router.js";
import { saveConfig, getConfig } from "./config.js";
import { writeStatusFile, deleteStatusFile } from "./statusFile.js";
import { PlanCostTracker } from "./planCostTracker.js";
import { hookRegistry } from "./hooks.js";
import { skillRegistry, loadDefaultSkills } from "./skillLoader.js";
import { AutoDreamDaemon } from "./autoDream.js";
import { memoryStore } from "./memoryStore.js";
import { loadAgentDefinitions, getAgentDefinition } from "./agentDefinitionLoader.js";
import { registerBuiltins } from "./builtinAgents.js";

// Register built-in agent definitions up-front so every command can see them.
registerBuiltins();

const planCostTracker = new PlanCostTracker();

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

    // Validate SDK is available (fail fast instead of silent failure in runOperator)
    try {
      await import("@anthropic-ai/claude-agent-sdk");
    } catch {
      console.error("[claude-drive] FATAL: @anthropic-ai/claude-agent-sdk not installed.");
      console.error("[claude-drive] Run: npm install @anthropic-ai/claude-agent-sdk");
      process.exit(1);
    }

    // Initialize hooks, skills, and auto-dream
    {
      const { hooksDir: defaultHooksDir, expandUserHome } = await import("./paths.js");
      const configured = getConfig<string>("hooks.directory");
      const dir = configured ? expandUserHome(configured) : defaultHooksDir();
      hookRegistry.loadFromDirectory(dir);
      hookRegistry.loadFromConfig();
    }
    loadDefaultSkills();
    const dreamDaemon = new AutoDreamDaemon();
    dreamDaemon.start();

    // Fire SessionStart hook (hooks are now guaranteed to be loaded)
    void hookRegistry.execute("SessionStart", { event: "SessionStart", timestamp: Date.now() });

    // Lazy-import MCP server to keep startup fast when not needed
    const { startMcpServer, getPortFilePath } = await import("./mcpServer.js");
    const { port: boundPort } = await startMcpServer({
      port, registry, driveMode, dreamDaemon,
      onTaskComplete: (completedOp, stats) => {
        registry.recordTaskStats(completedOp.name, stats.totalCostUsd, stats.durationMs, stats.apiDurationMs, stats.numTurns);
        planCostTracker.recordCost(stats.totalCostUsd, stats.durationMs, stats.numTurns);
      },
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

    // Track plan cost boundaries on mode changes
    driveMode.on("change", (state: { subMode: string }) => {
      planCostTracker.onModeChange(state.subMode);
    });

    // Flush status.json on every state change for the status line script
    function flushStatus(): void {
      const totals = registry.getTotalStats();
      const currentPlan = planCostTracker.getCurrentPlan();
      const lastPlan = planCostTracker.getLastCompletedPlan();
      writeStatusFile({
        active: driveMode.active,
        subMode: driveMode.subMode,
        foregroundOperator: registry.getForeground()?.name ?? null,
        operators: registry.getActive().map((o) => ({
          name: o.name, status: o.status, role: o.role, task: o.task ?? "",
          stats: {
            costUsd: o.stats.totalCostUsd,
            durationMs: o.stats.totalDurationMs,
            apiDurationMs: o.stats.totalApiDurationMs,
            turns: o.stats.totalTurns,
            taskCount: o.stats.taskCount,
          },
        })),
        totals: {
          costUsd: totals.totalCostUsd,
          durationMs: totals.totalDurationMs,
          apiDurationMs: totals.totalApiDurationMs,
          turns: totals.totalTurns,
          taskCount: totals.taskCount,
        },
        currentPlan: currentPlan ? {
          planIndex: currentPlan.planIndex,
          costUsd: currentPlan.costUsd,
          durationMs: currentPlan.durationMs,
          turns: currentPlan.turns,
          taskCount: currentPlan.taskCount,
          active: true,
        } : null,
        lastCompletedPlan: lastPlan ? {
          planIndex: lastPlan.planIndex,
          costUsd: lastPlan.costUsd,
          durationMs: lastPlan.durationMs,
          turns: lastPlan.turns,
          taskCount: lastPlan.taskCount,
          active: false,
        } : null,
        updatedAt: Date.now(),
      });
    }
    registry.onDidChange(flushStatus);
    driveMode.on("change", flushStatus);
    flushStatus(); // initial write

    // Keep process alive
    process.stdin.resume();
    process.on("SIGINT", () => {
      dreamDaemon.stop();
      void hookRegistry.execute("SessionStop", { event: "SessionStop", timestamp: Date.now() });
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
    driveMode.setSubMode(decision.mode as DriveSubMode);
    logActivity("router", decision.reason);
    const op = registry.spawn(opts.name, task, {
      role: parseRole(opts.role),
      preset: parsePreset(opts.preset),
    });
    await runOperator(op, task, {
      allOperators: registry.getActive(),
      onTaskComplete: (completedOp, stats) => {
        registry.recordTaskStats(completedOp.name, stats.totalCostUsd, stats.durationMs, stats.apiDurationMs, stats.numTurns);
        planCostTracker.recordCost(stats.totalCostUsd, stats.durationMs, stats.numTurns);
      },
    });
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
      role: parseRole(opts.role),
      preset: parsePreset(opts.preset),
    });
    console.log(`[claude-drive] Spawned operator: ${op.name} (${op.permissionPreset})`);
    printStatus(driveMode.active, driveMode.subMode, op.name, registry.getActive().length - 1);
  });

operatorCmd
  .command("list")
  .description("List active operators")
  .option("--json", "Emit machine-readable JSON on stdout")
  .action((opts: { json?: boolean }) => {
    const ops = registry.getActive();
    const fgId = registry.getForeground()?.id;
    if (opts.json) {
      console.log(JSON.stringify(
        ops.map((o) => ({
          id: o.id,
          name: o.name,
          status: o.status,
          role: o.role,
          preset: o.permissionPreset,
          task: o.task,
          isForeground: o.id === fgId,
          executionMode: o.executionMode,
        })),
        null,
        2,
      ));
      return;
    }
    if (ops.length === 0) { console.log("No active operators."); return; }
    for (const op of ops) {
      const fg = fgId === op.id ? " [fg]" : "";
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
    if (!isSubMode(mode)) {
      console.error(`[claude-drive] Invalid mode: ${mode}. Valid: plan, agent, ask, debug, off`);
      return;
    }
    driveMode.setSubMode(mode);
    console.log(`[claude-drive] Mode: ${mode}`);
    printStatus(driveMode.active, mode, registry.getForeground()?.name);
  });

modeCmd
  .command("status")
  .description("Show current drive state")
  .option("--json", "Emit machine-readable JSON on stdout")
  .action((opts: { json?: boolean }) => {
    if (opts.json) {
      console.log(JSON.stringify({
        active: driveMode.active,
        subMode: driveMode.subMode,
        foregroundOperator: registry.getForeground()?.name ?? null,
        activeCount: registry.getActive().length,
      }, null, 2));
      return;
    }
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

// ── skill ─────────────────────────────────────────────────────────────────

const skillCmd = program.command("skill").description("Manage skills");

skillCmd
  .command("list")
  .description("List available skills")
  .action(() => {
    loadDefaultSkills();
    const skills = skillRegistry.list();
    if (skills.length === 0) { console.log("No skills available. Add .md files to ~/.claude-drive/skills/"); return; }
    for (const s of skills) {
      console.log(`  ${s.name}: ${s.description}${s.tags ? ` [${s.tags.join(", ")}]` : ""}`);
    }
  });

skillCmd
  .command("show <name>")
  .description("Show a skill's resolved prompt")
  .action((name: string) => {
    loadDefaultSkills();
    const skill = skillRegistry.get(name);
    if (!skill) { console.error(`[claude-drive] Skill not found: ${name}`); return; }
    console.log(`--- ${skill.name} ---`);
    console.log(skill.prompt);
  });

// ── agent ─────────────────────────────────────────────────────────────────

const agentCmd = program.command("agent").description("Manage agent definitions");

agentCmd
  .command("list")
  .description("List all agent definitions (builtin + user + project)")
  .option("--json", "Emit machine-readable JSON on stdout")
  .action((opts: { json?: boolean }) => {
    const defs = loadAgentDefinitions();
    if (opts.json) {
      console.log(JSON.stringify(defs, null, 2));
      return;
    }
    if (defs.length === 0) { console.log("No agent definitions."); return; }
    for (const d of defs) {
      const tags: string[] = [`[${d.scope ?? "user"}]`];
      if (d.role) tags.push(`role=${d.role}`);
      if (d.preset) tags.push(`preset=${d.preset}`);
      if (d.effort) tags.push(`effort=${d.effort}`);
      if (d.background) tags.push("background");
      console.log(`  ${d.name} ${tags.join(" ")} — ${d.description}`);
    }
  });

agentCmd
  .command("show <name>")
  .description("Show the full resolved agent definition")
  .action((name: string) => {
    const def = getAgentDefinition(name);
    if (!def) { console.error(`[claude-drive] Agent not found: ${name}`); process.exitCode = 1; return; }
    console.log(JSON.stringify(def, null, 2));
  });

// ── dream ─────────────────────────────────────────────────────────────────

program
  .command("dream")
  .description("Manually trigger a dream memory consolidation cycle")
  .action(async () => {
    const { runDreamCycle } = await import("./autoDream.js");
    const result = runDreamCycle();
    console.log(`[claude-drive] ${result.summary}`);
    const stats = memoryStore.stats();
    console.log(`[claude-drive] Memory: ${stats.total} entries`);
  });

// ── session (enhanced) ────────────────────────────────────────────────────

const sessionCmd = program.command("session").description("Session management");

sessionCmd
  .command("list")
  .description("List saved sessions")
  .option("--json", "Emit machine-readable JSON on stdout")
  .action(async (opts: { json?: boolean }) => {
    const { listSessions } = await import("./sessionManager.js");
    const sessions = listSessions();
    if (opts.json) {
      console.log(JSON.stringify(
        sessions.map((s) => ({
          id: s.id,
          name: s.name ?? null,
          createdAt: s.createdAt,
          operatorCount: s.operators.filter((o: { status: string }) => o.status !== "completed").length,
        })),
        null,
        2,
      ));
      return;
    }
    if (sessions.length === 0) { console.log("No saved sessions."); return; }
    for (const s of sessions) {
      const date = new Date(s.createdAt).toLocaleString();
      const opCount = s.operators.filter((o: { status: string }) => o.status !== "completed").length;
      console.log(`  ${s.id}  ${s.name ?? "(unnamed)"}  ${date}  ${opCount} operator(s)`);
    }
  });

sessionCmd
  .command("checkpoint [name]")
  .description("Create a checkpoint of current state")
  .action(async (name?: string) => {
    const { createCheckpoint } = await import("./checkpoint.js");
    const sessionId = `session-${Date.now()}`;
    const cp = createCheckpoint(sessionId, registry, driveMode, [], name);
    console.log(`[claude-drive] Checkpoint created: ${cp.id}`);
  });

sessionCmd
  .command("restore <checkpointId>")
  .description("Restore state from a checkpoint")
  .action(async (checkpointId: string) => {
    const { restoreCheckpoint } = await import("./checkpoint.js");
    const result = restoreCheckpoint(checkpointId, registry, driveMode);
    console.log(result.ok ? `[claude-drive] Restored: ${checkpointId}` : `[claude-drive] Not found: ${checkpointId}`);
  });

sessionCmd
  .command("fork [name]")
  .description("Fork current session")
  .option("--from <checkpointId>", "Fork from a specific checkpoint")
  .action(async (name: string | undefined, opts: { from?: string }) => {
    const { forkSession } = await import("./checkpoint.js");
    const sessionId = `session-${Date.now()}`;
    try {
      const result = forkSession(sessionId, registry, driveMode, [], opts.from, name);
      console.log(`[claude-drive] Forked: ${result.newSessionId}`);
    } catch (e) {
      console.error(`[claude-drive] Fork failed: ${e}`);
    }
  });

// ── memory ────────────────────────────────────────────────────────────────

const memoryCmd = program.command("memory").description("Memory management");

memoryCmd
  .command("stats")
  .description("Show memory statistics")
  .option("--json", "Emit machine-readable JSON on stdout")
  .action((opts: { json?: boolean }) => {
    const stats = memoryStore.stats();
    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
    console.log(`[claude-drive] Memory: ${stats.total} entries`);
    console.log(`  By kind: ${JSON.stringify(stats.byKind)}`);
    console.log(`  By operator: ${JSON.stringify(stats.byOperator)}`);
  });

memoryCmd
  .command("list")
  .description("List recent memory entries")
  .option("--limit <n>", "Max entries", "20")
  .option("--json", "Emit machine-readable JSON on stdout")
  .action(async (opts: { limit: string; json?: boolean }) => {
    const { recall } = await import("./memoryManager.js");
    const entries = recall(undefined, { limit: parseInt(opts.limit, 10) });
    if (opts.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    for (const e of entries) {
      console.log(`  [${e.kind}] (${e.id.slice(0, 8)}) conf=${e.confidence.toFixed(2)} ${e.content.slice(0, 80)}`);
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
