# 05 — TTS & Voice Research

> **Auditor:** Claude Opus 4.6 | **Date:** 2026-03-26 | **Verdict:** DEFER from MVP

---

## Architecture Overview

Three-tier fallback architecture: Edge-TTS (cloud) → Piper (local) → system `say`

- **Lifecycle**: State machine tracking `inProgressUtterance`, spoken history (20-item ring buffer), interruption tracking
- **Integration**: MCP tools (`tts_speak`, `tts_stop`) + CLI command + operator task notifications

---

## Platform Compatibility Matrix

| Capability | macOS | Linux | Windows 11 | iOS (web audio) |
|------------|-------|-------|------------|-----------------|
| **Edge TTS** | ✓ | ✓ | ✓ | ✗ (needs fetch impl) |
| **Piper** | ✓ | ✓ | ✓ (shell spawn) | ✗ |
| **System say** | ✓ (`say`) | ✓ (`espeak`) | ✗ | ✗ |
| **Playback cmd** | afplay | aplay | PowerShell SoundPlayer | Web Audio API |

---

## Backend Details

### Edge-TTS (`src/edgeTts.ts`, 74 LOC)
- **Package**: `edge-tts-universal` (optional)
- **Internet**: Required (Microsoft cloud synthesis)
- **Cost**: Free tier with soft rate limits
- **Default voice**: `en-US-EmmaMultilingualNeural`
- **Playback**: Generates MP3, writes to tempfile, spawns OS command:
  - macOS: `afplay`
  - Linux: `aplay`
  - Windows: `powershell -Command "$p = New-Object System.Media.SoundPlayer; ..."`

### Piper (`src/piper.ts`, 85 LOC)
- **Setup**: Manual (user downloads binary + model files)
- **Binary**: https://github.com/rhasspy/piper/releases (cross-platform)
- **Models**: https://huggingface.co/rhasspy/piper-voices (19 languages, 50+ voices)
- **Auto-download**: No — requires `tts.piperBinaryPath` + `tts.piperModelPath`
- **Windows**: Available; spawned via `shell: true` on win32

### System `say` (lazy-loaded npm `say` package)
- **macOS**: Native `say` command (built-in)
- **Linux**: Wraps `espeak` (assumes installed)
- **Windows**: No native support (fails silently)

---

## Features

### Sentence Truncation
- **Location**: `tts.ts:60-65`
- **Regex**: `/[^.!?\n]+[.!?\n]+/g`
- **Default**: 3 sentences max (`tts.maxSpokenSentences`)

### Spoken History
- 20-item ring buffer for debug/audit
- Interruption markers: `[interrupted] <text>`
- Exposed via `getSpokenHistory()`

### Async Behavior
- **Non-blocking**: Synthesis and playback are out-of-process (`child_process.spawn`)
- Node.js main thread continues accepting input during playback

---

## Configuration Keys

| Key | Type | Default | Used? |
|-----|------|---------|-------|
| `tts.enabled` | boolean | `true` | ✓ |
| `tts.backend` | string | `"edgeTts"` | ✓ |
| `tts.voice` | string? | undefined | ✓ |
| `tts.speed` | number | 1.0 | ✓ (clamped 0.5-2.0) |
| `tts.volume` | number | 0.8 | **NOT IMPLEMENTED** |
| `tts.maxSpokenSentences` | number | 3 | ✓ |
| `tts.interruptOnInput` | boolean | true | Config exists, not enforced |
| `tts.piperBinaryPath` | string? | undefined | ✓ (piper only) |
| `tts.piperModelPath` | string? | undefined | ✓ (piper only) |

---

## Usage in Codebase

| File | Usage | Purpose |
|------|-------|---------|
| operatorManager.ts:131 | `speak()` | Task start notification |
| operatorManager.ts:182 | `speak("Rate limited")` | Rate limit UX feedback |
| operatorManager.ts:205 | `speak("done")` | Task completion |
| cli.ts:275 | `speak(text)` | User CLI command |
| mcpServer.ts:170 | MCP `tts_speak` | Agent-driven narration |
| mcpServer.ts:178 | MCP `tts_stop` | Stop playback |

**Total**: 3 hard-coded calls + 2 MCP tools.

---

## Unix Philosophy Assessment

**Violations:**
1. **Does too much**: Combines synthesis, playback, history tracking, interruption state
2. **Dependencies**: edge-tts-universal, say, piper — weight for a nice-to-have feature

**Clean disable**: Yes — `tts.enabled: false` guard at top of `speak()`. ~10 LOC to fully disable.

---

## MVP Recommendation: DEFER

**Rationale:**
- Voice narration is nice-to-have, not core to multi-operator orchestration
- Piper adds friction (manual binary+model setup)
- Edge-TTS adds network dependency
- `say` works only macOS (Linux needs espeak, Windows fails)
- Only 3 hard-coded calls; rarely invoked by agents

**Migration path:**
1. Set `tts.enabled: false` in config defaults
2. Keep code in-tree (cursor-drive compat)
3. Move `edge-tts-universal` + `say` to optional peerDependencies
4. Document: "Enable with `claude-drive config set tts.enabled true`"

**Cost to defer**: ~5 minutes. **Cost to ship unprepared**: Platform fragmentation, user friction.
