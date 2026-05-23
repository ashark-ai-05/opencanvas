# Contributing to OpenCanvas

Thanks for being here. OpenCanvas is a one-person hobby project that's
slowly becoming a real tool. PRs, issues, and design feedback are all
welcome — read the rest of this file before you spend time on a change
you'd hate to throw away.

## Quick start

```bash
git clone https://github.com/ashark-ai-05/opencanvas.git
cd opencanvas
pnpm install
cp .env.example .env       # add at least one provider key (Anthropic / OpenAI / Ollama / …)
pnpm cli --probe           # confirms backend + provider + embedder boot cleanly
pnpm electron:dev          # full stack — backend (3457) + vite (3458) + electron
```

Headless without Electron:

```bash
pnpm dev                   # → http://127.0.0.1:3458
```

## What we look for in a PR

- **One change per PR.** A bug fix + a refactor + a doc tweak in one
  diff is three PRs in a trench coat.
- **Test the new code.** `pnpm test` for backend, `pnpm vitest run
  --config app/vite.config.ts` for the frontend. New features need
  tests; bug fixes need a regression test.
- **Type-clean.** `pnpm typecheck` must pass.
- **Don't break the SDK contract.** `POST /v1/canvas/widgets` and the
  widget kind catalog are public surface — additive changes only,
  removals or renames need a deprecation window.
- **Match the prevailing style.** No new lint config, no Prettier
  config, no helper layers — keep the code roughly aligned with what's
  already there.

## Commit conventions

Conventional Commits, loosely:

- `feat(canvas): …` — new feature visible to the user
- `fix(chat): …` — bug fix
- `chore(deps): …` — non-functional housekeeping (dep bumps, build
  config, lint config)
- `refactor(...)` — pure code-shape change, no behavior diff
- `docs(...)` — README / SECURITY / etc.
- `test(...)` — adding/changing tests

The scope is the directory you touched the most (`canvas`, `chat`,
`agent`, `kb`, `backend`, `widgets`, `electron`, etc.).

## What's in / out of scope

**In:** new widget kinds, new MCP source integrations, new LLM
providers, accessibility fixes, performance work, security
improvements, doc polish, electron-builder/CI improvements.

**Out:** anything that turns OpenCanvas into a multi-user / hosted
product. The threat model is single-user local; PRs that assume a
remote deployment will be politely closed.

## Filing a good issue

1. **Reproduction steps.** What did you do, what did you expect, what
   happened.
2. **Environment.** `pnpm cli --probe` output, OS, Node version.
3. **Logs.** Backend stdout + DevTools console (in Electron:
   View → Toggle DevTools).
4. **Screenshot or 5-second screen recording** if it's visual.

## Security issues

See [SECURITY.md](./SECURITY.md). Please don't post vulns to public
issues — email first.

## Code of conduct

Be kind. Disagreements about code are fine; personal attacks are not.
This is a side project, not a job — please don't yell at the
maintainer (or each other) over a missed PR review window.
