/**
 * store.ts — Simple JSON file-based key-value store.
 * Replaces vscode.Memento for state persistence outside VS Code.
 */
import fs from "fs";
import path from "path";
import os from "os";

const STORE_DIR = path.join(os.homedir(), ".claude-drive");
const STORE_FILE = path.join(STORE_DIR, "state.json");

let cache: Record<string, unknown> = {};
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    if (fs.existsSync(STORE_FILE)) {
      cache = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
    }
  } catch {
    cache = {};
  }
  loaded = true;
}

function flush(): void {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (e) {
    console.error("[store] Failed to flush:", e);
  }
}

export const store = {
  get<T>(key: string, defaultValue: T): T {
    ensureLoaded();
    return key in cache ? (cache[key] as T) : defaultValue;
  },
  update(key: string, value: unknown): void {
    ensureLoaded();
    cache[key] = value;
    flush();
  },
  keys(): readonly string[] {
    ensureLoaded();
    return Object.keys(cache);
  },
};
