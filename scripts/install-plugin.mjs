#!/usr/bin/env node
/**
 * install-plugin.mjs — Register claude-drive as a stdio MCP server in Claude Desktop.
 * Usage: node scripts/install-plugin.mjs
 */
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "../out/cli.js");

// Determine claude_desktop_config.json path per platform
function getDesktopConfigPath() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(os.homedir(), "AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }
  // macOS
  return join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

const configPath = getDesktopConfigPath();

// Read existing config (or start fresh)
let desktopConfig = {};
if (existsSync(configPath)) {
  try {
    desktopConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    console.error(`[install-plugin] Warning: could not parse ${configPath}, will overwrite.`);
  }
}

// Merge in claude-drive entry
if (!desktopConfig.mcpServers) desktopConfig.mcpServers = {};
desktopConfig.mcpServers["claude-drive"] = {
  type: "stdio",
  command: "node",
  args: [cliPath, "serve-stdio"],
};

mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(configPath, JSON.stringify(desktopConfig, null, 2), "utf-8");

console.log(`[install-plugin] claude-drive registered.`);
console.log(`[install-plugin] CLI path: ${cliPath}`);
console.log(`[install-plugin] Config updated: ${configPath}`);
