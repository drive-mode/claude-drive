#!/usr/bin/env node
/**
 * dev.js — Zero-dep dev orchestrator for claude-drive.
 *
 * Runs tsc in watch mode and automatically (re)starts the MCP server
 * whenever compiled output changes. Clean shutdown on SIGINT.
 *
 * Usage:
 *   node scripts/dev.js [-- <server args>]
 *
 * Examples:
 *   node scripts/dev.js
 *   node scripts/dev.js -- -p 7892
 */
import { spawn } from "child_process";
import { existsSync, watch } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out");
const ENTRY = path.join(OUT, "cli.js");

// Forward any args after `--` to the server
const dashIdx = process.argv.indexOf("--");
const serverArgs = dashIdx >= 0 ? process.argv.slice(dashIdx + 1) : [];

let tscProc = null;
let serverProc = null;
let restartTimer = null;
let shuttingDown = false;
let firstCompile = true;

function log(tag, msg) {
  const ts = new Date().toTimeString().slice(0, 8);
  const color = tag === "tsc" ? "\x1b[36m" : tag === "srv" ? "\x1b[32m" : "\x1b[33m";
  process.stdout.write(`${color}[${ts} ${tag}]\x1b[0m ${msg}\n`);
}

function pipePrefixed(stream, tag) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (line.trim()) log(tag, line);
    }
  });
}

function startTsc() {
  log("dev", "Starting tsc --watch...");
  tscProc = spawn("node", ["node_modules/typescript/bin/tsc", "-w", "-p", "./"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  pipePrefixed(tscProc.stdout, "tsc");
  pipePrefixed(tscProc.stderr, "tsc");
  tscProc.on("exit", (code) => {
    if (!shuttingDown) log("dev", `tsc exited with code ${code}`);
  });
}

function startServer() {
  if (!existsSync(ENTRY)) {
    log("dev", "Waiting for first compile...");
    return;
  }
  log("srv", `Starting: node ${ENTRY} start ${serverArgs.join(" ")}`);
  serverProc = spawn("node", [ENTRY, "start", ...serverArgs], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  pipePrefixed(serverProc.stdout, "srv");
  pipePrefixed(serverProc.stderr, "srv");
  serverProc.on("exit", (code, signal) => {
    serverProc = null;
    if (!shuttingDown && signal !== "SIGTERM") {
      log("dev", `Server exited (code=${code}, signal=${signal})`);
    }
  });
}

function restartServer() {
  if (shuttingDown) return;
  if (serverProc) {
    log("dev", "Rebuild detected — restarting server...");
    const proc = serverProc;
    const forceKill = setTimeout(() => {
      if (!proc.killed) {
        log("dev", "SIGINT timeout — escalating to SIGKILL");
        proc.kill("SIGKILL");
      }
    }, 3000);
    proc.once("exit", () => {
      clearTimeout(forceKill);
      setTimeout(startServer, 100);
    });
    // cli.ts only handles SIGINT (not SIGTERM) — must match its expected shutdown signal
    proc.kill("SIGINT");
  } else {
    startServer();
  }
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (firstCompile) {
      firstCompile = false;
      log("dev", "First compile done — starting server");
      startServer();
    } else {
      restartServer();
    }
  }, 400);
}

function watchOut() {
  // Poll for out/cli.js existence then set up fs.watch
  const check = () => {
    if (existsSync(OUT)) {
      log("dev", `Watching ${OUT} for changes`);
      watch(OUT, { recursive: true }, (_event, filename) => {
        if (filename && filename.endsWith(".js")) scheduleRestart();
      });
    } else {
      setTimeout(check, 250);
    }
  };
  check();
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("dev", "Shutting down...");
  if (serverProc) serverProc.kill("SIGINT");
  if (tscProc) tscProc.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startTsc();
watchOut();
