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
npm run watch    # TypeScript watch
npm test         # Jest (requires --experimental-vm-modules)
```

## Pull Requests

All PRs require review from at least one maintainer. CODEOWNERS enforces this on GitHub. Squash-merge preferred for feature branches.
