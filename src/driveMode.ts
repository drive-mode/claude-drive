/**
 * driveMode.ts — Drive state machine for claude-drive.
 * Adapted from cursor-drive: replaced vscode.Memento → store.ts, vscode.EventEmitter → Node EventEmitter.
 */
import { EventEmitter } from "events";
import { store } from "./store.js";
import { getConfig } from "./config.js";
import { hookRegistry } from "./hooks.js";

export type DriveSubMode = "ask" | "agent" | "plan" | "debug" | "off";

export interface DriveState {
  active: boolean;
  subMode: DriveSubMode;
}

export function isSubMode(value: unknown): value is DriveSubMode {
  return value === "plan" || value === "agent" || value === "ask" || value === "debug" || value === "off";
}

export interface DriveModeManager {
  readonly active: boolean;
  readonly subMode: DriveSubMode;
  setActive(active: boolean): void;
  setSubMode(mode: DriveSubMode): void;
  toggle(): void;
  on(event: "change", listener: (state: DriveState) => void): void;
  off(event: "change", listener: (state: DriveState) => void): void;
  dispose(): void;
}

export function createDriveModeManager(): DriveModeManager {
  const emitter = new EventEmitter();

  let _active: boolean = store.get<boolean>("drive.active", false);
  let _subMode: DriveSubMode = (() => {
    const stored = store.get<string>("drive.subMode", "");
    if (isSubMode(stored) && stored !== "off") return stored;
    return (getConfig<string>("drive.defaultMode") as DriveSubMode) ?? "agent";
  })();

  function fire(): void {
    emitter.emit("change", { active: _active, subMode: _subMode });
    // Fire ModeChange hook (non-blocking)
    void hookRegistry.execute("ModeChange", {
      event: "ModeChange", mode: _subMode, timestamp: Date.now(),
    });
  }

  const manager: DriveModeManager = {
    get active() { return _active; },
    get subMode() { return _subMode; },

    setActive(active: boolean): void {
      if (_active === active) return;
      _active = active;
      store.update("drive.active", _active);
      fire();
    },

    setSubMode(mode: DriveSubMode): void {
      if (_subMode === mode) return;
      _subMode = mode;
      store.update("drive.subMode", _subMode);
      fire();
    },

    toggle(): void {
      if (!_active) {
        const configMode = getConfig<string>("drive.defaultMode");
        if (isSubMode(configMode) && configMode !== "off") {
          _subMode = configMode;
          store.update("drive.subMode", _subMode);
        }
      }
      _active = !_active;
      store.update("drive.active", _active);
      fire();
    },

    on(event, listener) { emitter.on(event, listener); },
    off(event, listener) { emitter.off(event, listener); },
    dispose() { emitter.removeAllListeners(); },
  };

  return manager;
}
