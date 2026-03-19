# claude-drive v0.1 Stabilization Plan

**Updated:** 2026-03-18
**Goal:** Stable, public, dual-maintainer claude-drive on GitHub before roler.ai ACP harness begins.

## Done (2026-03-18)

- [x] Initial scaffold (cli.ts, mcpServer.ts, operatorManager.ts, operatorRegistry.ts, driveMode.ts,
      agentOutput.ts, tts.ts, sessionManager.ts, worktreeManager.ts, store.ts, config.ts, syncTypes.ts)
- [x] README.md — setup, usage, architecture
- [x] AGENTS.md — AI agent context, key files, sync protocol
- [x] package.json — author and homepage fixed (Harrison Halperin / github.com/hhalperin)
- [x] .github/CODEOWNERS — @hhalperin @ai-secretagent
- [x] CONTRIBUTING.md — commit guidelines, co-author trailers, sync protocol
- [x] push to GitHub (develop branch)

## In Progress

- [ ] Sync cursor-drive v1 fixes (blocked on cursor-drive v1 shipping)
- [ ] First real feature commits from hhalperin beyond docs

## Next (after cursor-drive v1)

- [ ] Sync syncTypes.ts, operatorRegistry.ts, router.ts from cursor-drive v1
- [ ] Sync tts.ts, edgeTts.ts, piper.ts
- [ ] Add npm publish workflow
- [ ] Add claude-drive to npm registry (package name: `claude-drive`)
- [ ] Integration test: claude-drive start → Claude Code MCP connection → operator spawn

## Portfolio Context

See [drive-mode-portfolio-roadmap.md](drive-mode-portfolio-roadmap.md) for how claude-drive fits
into the broader drive-mode + roler.ai strategy.
