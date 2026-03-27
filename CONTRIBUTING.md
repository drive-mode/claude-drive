# Contributing to claude-drive

## Maintainers

- [@hhalperin](https://github.com/hhalperin) — lead
- [@ai-secretagent](https://github.com/ai-secretagent) — co-maintainer

## Commit Guidelines

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`

Keep commits atomic. Include co-author trailers when both maintainers contribute:

```
Co-Authored-By: Harrison Halperin <harrisonhalperin@gmail.com>
Co-Authored-By: ai-secretagent <super.ai.secretagent@gmail.com>
```

## Sync with cursor-drive

This project shares logic with [`cursor-drive`](https://github.com/hhalperin/cursor-drive). When syncing:

- Copy `operatorRegistry.ts`, `router.ts`, `syncTypes.ts` with minor import fixes
- Keep `tts.ts`, `edgeTts.ts`, `piper.ts` in sync manually
- Do not sync VS Code extension files (`package.json`, `extension.ts`, etc.)

## Development

```bash
npm install
npm run compile  # TypeScript build
npm run watch    # TypeScript watch
npm test         # Jest (176 tests across 17 files, requires --experimental-vm-modules)
```

## Key Conventions

- All persistence must use `atomicWriteJSON()` from `src/atomicWrite.ts` — never raw `fs.writeFileSync` for JSON state files
- SDK versions are pinned to exact versions in `package.json` — never use `latest`
- ESM imports require `.js` extensions on all relative paths
- Named exports only — no default exports in `src/`

## Pull Requests

All PRs require review from at least one maintainer. CODEOWNERS enforces this on GitHub. Squash-merge preferred for feature branches.
