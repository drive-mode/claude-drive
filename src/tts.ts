/**
 * tts.ts — Text-to-speech for claude-drive.
 * Adapted from cursor-drive: removed webview backend, replaced vscode config → getConfig().
 * Backend order: edgeTts → piper → say
 */
import { speakPiper, stopPiper, isPiperAvailable } from "./piper.js";
import { speakEdgeTts, stopEdgeTts, isEdgeTtsAvailable } from "./edgeTts.js";
import { getConfig } from "./config.js";

const SPOKEN_HISTORY_SIZE = 20;
const spokenHistory: string[] = [];
let inProgressUtterance: string | undefined;
let onPlaybackEndedCallback: (() => void) | null = null;

export function getSpokenHistory(): string[] { return [...spokenHistory]; }
export function wasLastInterrupted(): boolean { return inProgressUtterance !== undefined; }
export function clearSpokenHistory(): void { spokenHistory.length = 0; inProgressUtterance = undefined; }
export function setOnPlaybackEnded(cb: () => void): void { onPlaybackEndedCallback = cb; }

export interface TtsConfig {
  enabled: boolean;
  backend: "edgeTts" | "piper" | "say";
  voice: string | undefined;
  speed: number;
  volume: number;
  maxSpokenSentences: number;
  interruptOnInput: boolean;
}

export function getTtsConfig(): TtsConfig {
  const backend = getConfig<string>("tts.backend") as TtsConfig["backend"];
  const voice = getConfig<string>("tts.voice");
  return {
    enabled: getConfig<boolean>("tts.enabled") ?? true,
    backend: ["edgeTts", "piper", "say"].includes(backend) ? backend : "edgeTts",
    voice: voice?.trim() || undefined,
    speed: Math.max(0.5, Math.min(2.0, getConfig<number>("tts.speed") ?? 1.0)),
    volume: Math.max(0.2, Math.min(1.0, getConfig<number>("tts.volume") ?? 0.8)),
    maxSpokenSentences: getConfig<number>("tts.maxSpokenSentences") ?? 3,
    interruptOnInput: getConfig<boolean>("tts.interruptOnInput") ?? true,
  };
}

/** Lazy-loaded say module. */
let sayModule: typeof import("say") | null | undefined = undefined;

function getSay(): typeof import("say") | null {
  if (sayModule !== undefined) return sayModule as typeof import("say") | null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sayModule = require("say");
    return sayModule as typeof import("say");
  } catch {
    sayModule = null;
    return null;
  }
}

function truncateToSentences(text: string, max: number): string {
  if (max <= 0) return "";
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g);
  if (!sentences || sentences.length === 0) return text.trim();
  return sentences.slice(0, max).join(" ").trim();
}

function pushSpoken(speech: string): void {
  spokenHistory.push(speech);
  if (spokenHistory.length > SPOKEN_HISTORY_SIZE) spokenHistory.shift();
}

function doSayFallback(speech: string, voice: string | undefined, speed: number): void {
  const say = getSay();
  if (!say) { inProgressUtterance = undefined; return; }
  say.stop();
  say.speak(speech, voice ?? undefined, speed, (err: string) => {
    if (err) console.error("[Drive TTS]", err);
    inProgressUtterance = undefined;
    pushSpoken(speech);
  });
}

export function speak(text: string, overrideVoice?: string): void {
  const cfg = getTtsConfig();
  if (!cfg.enabled) return;
  const speech = truncateToSentences(text.trim(), cfg.maxSpokenSentences);
  if (!speech) return;
  inProgressUtterance = speech;

  if (cfg.backend === "edgeTts" && isEdgeTtsAvailable()) {
    void speakEdgeTts(speech, cfg.volume, () => {
      inProgressUtterance = undefined;
      pushSpoken(speech);
    }).then((started) => {
      if (!started) doSayFallback(speech, overrideVoice ?? cfg.voice, cfg.speed);
    });
    return;
  }

  if (cfg.backend === "piper" && isPiperAvailable()) {
    if (speakPiper(speech, cfg.volume, () => { inProgressUtterance = undefined; pushSpoken(speech); })) return;
  }

  doSayFallback(speech, overrideVoice ?? cfg.voice, cfg.speed);
}

export function speakFull(text: string, voice?: string, speed?: number): void {
  const cfg = getTtsConfig();
  if (!cfg.enabled) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  inProgressUtterance = trimmed;

  if (cfg.backend === "edgeTts" && isEdgeTtsAvailable()) {
    void speakEdgeTts(trimmed, cfg.volume, () => {
      inProgressUtterance = undefined;
      pushSpoken(trimmed);
    }).then((started) => {
      if (!started) doSayFallback(trimmed, voice ?? cfg.voice, speed ?? cfg.speed);
    });
    return;
  }

  if (cfg.backend === "piper" && isPiperAvailable()) {
    if (speakPiper(trimmed, cfg.volume, () => { inProgressUtterance = undefined; pushSpoken(trimmed); })) return;
  }

  doSayFallback(trimmed, voice ?? cfg.voice, speed ?? cfg.speed);
}

export function stop(): void {
  stopPiper();
  stopEdgeTts();
  if (inProgressUtterance) {
    spokenHistory.push(`[interrupted] ${inProgressUtterance}`);
    if (spokenHistory.length > SPOKEN_HISTORY_SIZE) spokenHistory.shift();
    inProgressUtterance = undefined;
  }
  getSay()?.stop();
}

export function isEnabled(): boolean { return getTtsConfig().enabled; }

export function notifyPlaybackEnded(): void {
  if (inProgressUtterance) {
    spokenHistory.push(inProgressUtterance);
    if (spokenHistory.length > SPOKEN_HISTORY_SIZE) spokenHistory.shift();
    inProgressUtterance = undefined;
  }
  onPlaybackEndedCallback?.();
}
