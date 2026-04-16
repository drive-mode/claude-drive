/**
 * store.ts — Simple JSON file-based key-value store.
 * Replaces vscode.Memento for state persistence outside VS Code.
 */
import fs from "fs";
import path from "path";
import { atomicWriteJSON } from "./atomicWrite.js";
import { home } from "./paths.js";
import { logger } from "./logger.js";

function storeFile(): string {
  return path.join(home(), "state.json");
}

let cache: Record<string, unknown> = {};
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  try {
    const f = storeFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f)) {
      cache = JSON.parse(fs.readFileSync(f, "utf-8"));
    }
  } catch {
    cache = {};
  }
  loaded = true;
}

function flush(): void {
  try {
    atomicWriteJSON(storeFile(), cache);
  } catch (e) {
    logger.error("[store] Failed to flush:", e);
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
