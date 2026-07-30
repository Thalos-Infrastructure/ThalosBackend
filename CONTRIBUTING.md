# Contributing

## Bug fixes require a regression test

A bug-fix PR is **not done** until a corresponding regression test exists.

1. Add or extend a `*.regression.spec.ts` under `src/` (colocated with the feature).
2. Reference the originating issue and/or PR in the `describe`/`it` title or a header comment, e.g. `issue #52 / PR #54`.
3. The test must fail if the fixed bug is re-introduced locally.
4. Keep tests independent: no shared mutable state across files; mock Supabase and Trustless Work (no live network).

### Convention

| Rule | Detail |
| --- | --- |
| Naming | `src/<feature>/*.regression.spec.ts` (e.g. `webhook-status-mapping.regression.spec.ts`) |
| Discovery | Jest `testRegex` already matches `*.spec.ts`, so regression specs run in `pnpm test` and CI |
| Run only regressions | `pnpm exec jest regression --runInBand` |

See [docs/integration-tests.md](docs/integration-tests.md#regression-test-suite-issue-69) for the suite index (test → issue/PR).

## Before opening a PR

- Keep formatting and lint green (`pnpm run format:check`, `pnpm run lint:check`).
- Run `pnpm test` (or at least the specs you touched) and ensure CI stays green.
- Prefer atomic commits with Conventional Commit prefixes (`fix:`, `test:`, `docs:`, …).
