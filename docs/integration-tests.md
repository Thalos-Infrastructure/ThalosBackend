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

## KYC/KYB Integration Test Suite (issue #75)

`src/integration/kyc-kyb.integration.spec.ts` is the provider-agnostic compliance suite. It boots
real Nest controllers (`KybController`, `VerificationController`), real JWT / internal-secret
guards, and the global `ValidationPipe` against an in-memory Supabase fake. Identity vendors are
injected via `MockIdentityProvider` (`src/kyb/providers/mock-identity.provider.ts`) so Persona,
Sumsub, Onfido, and manual paths share the same cases — swap the DI binding, not the tests.

### Covered cases

| Area                            | Cases                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| KYB session create              | multi-provider pending / instant-verified / instant-rejected; provider 5xx; idempotent re-POST                               |
| KYB status                      | owner GET; admin successful review; failed review + reason; re-attempt after reject                                          |
| KYB invalid / authz             | 401, DTO 400, mass-assignment 400, bad UUID 400, 404, IDOR 403, non-admin review 403, finalize immutability                  |
| Provider mock surface           | `checkStatus` transitions + outage rejection                                                                                 |
| Verification API KYC (user)     | unverified default, success, reject, expired, pending, multi-provider level pick, IDOR, admin, internal secret               |
| Verification API KYB (business) | success, expired, non-admin 403                                                                                              |
| Webhooks                        | N/A — identity-vendor webhooks not implemented yet (Trustless Work only); placeholder documents expected coverage when added |

Run just this suite:

```bash
pnpm exec jest src/integration/kyc-kyb.integration.spec.ts --runInBand
```

This suite should stay green before merging compliance-related changes. Adding a new
`IdentityProvider` implementation only requires a new `MockIdentityProvider({ name, ... })` binding
in the existing cases — no rewrite of the HTTP assertions.

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
