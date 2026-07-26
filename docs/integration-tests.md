# Integration Tests

## Migrated Flow Integration Tests

The migrated backend flows are covered by `src/integration/migrated-flows.integration.spec.ts`.
These tests compile the Nest controllers/services and exercise them over HTTP with `supertest`.

## Covered Flows

- App login JWT generation/acceptance and invalid-token rejection.
- `GET /v1/wallets/with-balances`.
- `GET /v1/wallets/agreements`.
- `POST /v1/agreements`.
- `GET /v1/agreements/by-wallet`.
- `POST /v1/disputes`, resolver assignment, and `PATCH /v1/disputes/:id/resolve`.
- `GET /v1/escrows/by-signer/:address`.
- Guard coverage that fails if `lib/api` contains direct `supabase.from(...)` calls.

Each migrated endpoint has a happy-path assertion and an error-path assertion. The dispute
coverage includes the percentage-sum validation and unauthorized resolver validation.

## Test Fixtures

CI uses an in-memory Supabase-style fixture instead of a live Supabase project. The fixture models
the staging user/wallet shape expected by the frontend login flow:

- User: `staging-user-1`.
- Primary wallet: `GSTAGINGUSERWALLET000000000000000000000000000000000000000`.
- Secondary wallet: `GSTAGINGUSERSECOND000000000000000000000000000000000000`.
- Resolver wallet: `GSTAGINGRESOLVER000000000000000000000000000000000000`.

Trustless Work read calls are mocked with `global.fetch`, so CI does not require a Trustless Work
API key or network access. Keep live staging checks in smoke tests where credentials are available.

## Retry Queue Integration Tests

`src/integration/retry-queue.integration.spec.ts` covers the shared Trustless Work retry queue
(`src/retry-queue`) end-to-end: a mocked failing Trustless Work call retried to recovery, duplicate
idempotency-key blocking, and the admin-only `POST /v1/retry-queue/:id/retry` HTTP endpoint (including
the 403 rejection for non-admin users). It uses the same in-memory Supabase fixture pattern as the
migrated-flows suite, extended with the `lte` filter the retry queue's polling queries need.

## Running Locally

Install dependencies:

```bash
pnpm install
```

Run all tests:

```bash
pnpm test
```

Run only the migrated flow integration suite:

```bash
pnpm run test:integration
```

## CI

`.github/workflows/ci.yml` installs with `pnpm install --frozen-lockfile`, checks formatting and
linting, then runs:

```bash
pnpm exec jest --runInBand
```
