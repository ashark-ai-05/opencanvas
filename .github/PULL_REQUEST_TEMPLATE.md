<!-- Thanks for the PR! Quick checklist below — none of it is bureaucratic,
the goal is to land changes safely. -->

## What this changes

<!-- 1-3 sentences. Skip the "what" — explain the "why" if it isn't obvious. -->

## How to verify

<!-- Steps a reviewer can run to see this work as intended. -->

1.
2.

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (backend)
- [ ] `pnpm vitest run --config app/vite.config.ts` passes (app)
- [ ] If this changes user-visible behavior, `CHANGELOG.md` is updated
- [ ] If this changes the public `/v1/*` API or widget kind catalog,
      the change is additive (or there's a deprecation note)
- [ ] If this touches security, threat-model assumptions, or the auth
      flow — `SECURITY.md` is updated

## Screenshots / recordings

<!-- For UI changes. A 5-10 second screen recording beats a wall of text. -->
