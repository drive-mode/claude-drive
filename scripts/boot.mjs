#!/usr/bin/env node
/**
 * boot.mjs — Idempotent claude-drive environment bootstrap.
 *
 * Checks:
 *   1. node_modules installed?       → npm install
 *   2. .env has ANTHROPIC_API_KEY?   → copy from known locations or warn
 *   3. out/ compiled and fresh?      → npm run compile
 *   4. server already running?       → skip start
 *   5. start server in background    → detach and write port file
 *
 * Safe to run repeatedly — every step is a no-op if already satisfied.
 */

import { execSync, spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const PORT_FILE = join(homedir(), ".claude-drive", "port");

// Known locations where .env files with ANTHROPIC_API_KEY might live
const ENV_DONORS = [
  join(ROOT, ".env"),
  join(homedir(), ".env"),
  join(homedir(), "Documents", "Coding Projects", "business", "roler_ai", "roler", ".env"),
  join(homedir(), ".anthropic", ".env"),
];

function log(msg) {
  console.log(`[boot] ${msg}`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: "pipe", ...opts }).toString().trim();
}

// ── Step 1: node_modules ───────────────────────────────────────────────────

function ensureDeps() {
  if (existsSync(join(ROOT, "node_modules", ".package-lock.json"))) return;
  log("Installing dependencies...");
  execSync("npm install", { cwd: ROOT, stdio: "inherit" });
}

// ── Step 2: .env with ANTHROPIC_API_KEY ────────────────────────────────────

function findApiKey() {
  // Check current environment first
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

  // Search known .env files
  for (const donor of ENV_DONORS) {
    if (!existsSync(donor)) continue;
    const content = readFileSync(donor, "utf-8");
    const match = content.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match && match[1].trim()) return match[1].trim();
  }
  return null;
}

function ensureEnv() {
  const envPath = join(ROOT, ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";

  if (/^ANTHROPIC_API_KEY=.+/m.test(existing)) {
    return; // already has it
  }

  const key = findApiKey();
  if (!key) {
    log("WARNING: ANTHROPIC_API_KEY not found. Operators will not be able to call Claude.");
    log("Set it with: echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env");
    return;
  }

  // Append without duplicating
  const lines = existing ? existing.split("\n").filter((l) => !l.startsWith("ANTHROPIC_API_KEY=")) : [];
  lines.push(`ANTHROPIC_API_KEY=${key}`);
  writeFileSync(envPath, lines.filter(Boolean).join("\n") + "\n");
  log("ANTHROPIC_API_KEY written to .env");
}

// ── Step 3: Compile if stale ───────────────────────────────────────────────

function needsCompile() {
  const outCli = join(ROOT, "out", "cli.js");
  if (!existsSync(outCli)) return true;

  // Check if any src file is newer than out/cli.js
  const outMtime = statSync(outCli).mtimeMs;
  try {
    const srcFiles = run('find src -name "*.ts" -o -name "*.tsx"').split("\n");
    return srcFiles.some((f) => {
      try { return statSync(join(ROOT, f)).mtimeMs > outMtime; } catch { return false; }
    });
  } catch {
    return true;
  }
}

function ensureCompiled() {
  if (!needsCompile()) return;
  log("Compiling TypeScript...");
  execSync("npm run compile", { cwd: ROOT, stdio: "inherit" });
}

// ── Step 4: Check if server running ────────────────────────────────────────

async function isServerRunning() {
  // Check port file first
  if (!existsSync(PORT_FILE)) return false;
  const port = readFileSync(PORT_FILE, "utf-8").trim();
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Step 5: Start server ───────────────────────────────────────────────────

function startServer() {
  log("Starting claude-drive server...");

  // Ensure state directory exists
  mkdirSync(join(homedir(), ".claude-drive"), { recursive: true });

  const child = spawn("node", ["out/cli.js", "start"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  // Wait for the server to bind (watch for port file or stdout)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server did not start within 10 seconds"));
    }, 10_000);

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("MCP server listening")) {
        clearTimeout(timeout);
        child.unref();
        child.stdout.destroy();
        child.stderr.destroy();

        // Read the bound port
        const port = existsSync(PORT_FILE) ? readFileSync(PORT_FILE, "utf-8").trim() : "7891";
        resolve(parseInt(port, 10));
      }
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}: ${output.slice(-500)}`));
      }
    });
  });
}

// ── Step 6: Ensure registered in Claude Code ───────────────────────────────

function ensureRegistered(port) {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  mkdirSync(join(homedir(), ".claude"), { recursive: true });

  let settings = {};
  try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch {}

  const mcpServers = settings.mcpServers || {};
  const expected = `http://localhost:${port}/mcp`;

  if (mcpServers["claude-drive"]?.url === expected) return; // already registered

  mcpServers["claude-drive"] = { url: expected };
  settings.mcpServers = mcpServers;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  log(`Registered in ${settingsPath}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function boot() {
  log(`Root: ${ROOT}`);

  ensureDeps();
  ensureEnv();
  ensureCompiled();

  const running = await isServerRunning();
  if (running) {
    const port = readFileSync(PORT_FILE, "utf-8").trim();
    log(`Server already running on port ${port}`);
    ensureRegistered(parseInt(port, 10));
    log(`Dashboard: http://localhost:${port}/dashboard`);
    log("Ready.");
    return;
  }

  const port = await startServer();
  log(`Server started on port ${port}`);
  ensureRegistered(port);
  log(`MCP: http://localhost:${port}/mcp`);
  log(`Dashboard: http://localhost:${port}/dashboard`);
  log("Ready.");
}

boot().catch((err) => {
  console.error(`[boot] FATAL: ${err.message}`);
  process.exit(1);
});
