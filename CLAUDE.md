# ThalosBackend — CLAUDE.md

NestJS 11 API for Thalos, an escrow orchestration layer on Stellar built on top of
**Trustless Work** (TW). Data lives in Supabase (Postgres). The server never custodies
keys or funds: it builds unsigned transactions, the user's wallet signs them client-side,
and the server submits them.

> `AGENTS.md` predates this file and is partly stale (it claims there are no tests, no
> linter and no `.env.example` — all three are wrong). Prefer this file.

## Runtime

**Node 22+ is required, not Node 20**, even though `engines` says `>=20`. On Node 20 the
app boots, maps every route, then dies in `SupabaseService.onModuleInit` with
`Node.js detected but native WebSocket not found` — `@supabase/realtime-js` needs the
global `WebSocket`, which only exists from Node 22. **`.nvmrc` says `20` and is stale** —
do not trust it.

Package manager is **pnpm** (`packageManager` is pinned in `package.json`).

```bash
pnpm install
pnpm run start:dev      # watch mode, http://localhost:3001
```

| Command | What |
|---|---|
| `pnpm run start:dev` | watch mode |
| `pnpm run build` | `nest build` → `dist/` |
| `pnpm run format:check` / `format` | Prettier (CI runs `:check`) |
| `pnpm run lint:check` / `lint` | ESLint (CI runs `:check`) |
| `pnpm exec jest --runInBand` | full suite, as CI runs it |
| `pnpm exec jest integration --runInBand` | integration suites only |

## CI (`.github/workflows/ci.yml`)

Four parallel jobs — **Format, Lint, Test, Build** — plus a gitleaks secret scan and a
report-only coverage job. Install uses `pnpm install --frozen-lockfile`, so
`package.json` and `pnpm-lock.yaml` must always be committed together or CI fails before
running anything.

Lint currently reports ~667 warnings and 0 errors. Warnings do not fail the build; keep
new code at zero.

## Environment

Read from `.env.local` then `.env` (`ConfigModule.forRoot`, see `app.module.ts`).
`.env.example` is the full commented list. Required: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` (HS256, **must be byte-identical to the
frontend's**), `THALOS_INTERNAL_SECRET` (shared with Next for the internal relay).
Everything else has a default — see the README table.

## API shape

Global prefix `v1`. Swagger at `/v1/docs`, OpenAPI JSON at `/v1/docs-json`.

### Authentication and authorization

- **App JWT** — `JwtAuthGuard` (passport-jwt). The JWT is minted by the **frontend's**
  Next.js routes (`app/api/auth/*`), not here; this service only verifies it. Same
  `JWT_SECRET` on both sides.
- **Internal secret** — `x-thalos-internal-secret` for server-to-server calls from Next.
  `JwtOrInternalSecretGuard` accepts either.
- **`@Public()`** (`src/common/decorators/public.decorator.ts`) — opts a single handler
  out of `JwtAuthGuard` even inside a guarded controller. `JwtAuthGuard` reads it through
  `Reflector`, so **the guard can no longer be constructed with `new JwtAuthGuard()`** —
  inject a `Reflector` and pass it, the way `JwtOrInternalSecretGuard` does.

Only the two escrow read endpoints are `@Public()`. See
[`src/internal-trustless/CLAUDE.md`](src/internal-trustless/CLAUDE.md) for why, and for
the rate limiting that replaced the guard there.

### Authorization is thinner than it looks

Most escrow endpoints authenticate but do **not** bind the JWT user to the `signer` in the
body. That is deliberate: build endpoints only ever return an **unsigned XDR**, and the
transaction is worthless until the real signer's wallet signs it. Authorization is
enforced on-chain, not here. Do not add a write endpoint that has side effects before the
signature — that assumption is what makes the thin checks safe.

## Data model (Supabase)

`SupabaseService.getClient()` always uses the **service-role** key, so every query here
bypasses RLS. Authorization is the caller's job.

- `auth_users` — `id` is the JWT `sub`; holds `wallet_public_key`
- `profiles` — keyed by `wallet_address`, holds `role` / `account_type` and `email`
- `user_wallets` — additional wallets linked to a user
- `agreements`, `agreement_participants`, `agreement_activity`, `disputes`,
  `dispute_resolutions`

**`auth_users.id` is not `profiles.id`.** The two join through the wallet address, and
mixing them up is the most common source of "user not found" bugs here.

## Conventions

- The backend **only validates** JWTs, never signs them — signing lives in the frontend's
  Next routes. `@nestjs/jwt` is a dependency but unused; `jsonwebtoken` is test-only.
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` + `transform`, so a DTO
  that does not declare a property will reject the request rather than ignore the field.
- No cache and no Redis. Transient tokens (wallet challenges) use a stateless HMAC proof
  with a 5-minute TTL and **no nonce store**, so a challenge is replayable until it expires
  — see `src/wallets/helpers/stellar-verification.helper.ts`.

## Events and email notifications

`EventEmitterModule` (in-process, synchronous-ish). `AgreementsService` and
`DisputesService` emit `AGREEMENT_EVENTS.*`; `NotificationsListener` is the only
subscriber and never rethrows. `NotificationsService` resolves recipients from
`profiles.email` joined via `agreement_participants`, then sends through Resend.

**Every failure in this chain is silent by design**, which makes "no emails" hard to
diagnose. In order of likelihood:

1. **The agreement was never persisted here.** The dashboard's create flow talks straight
   to Trustless Work and never calls `POST /v1/agreements`, so no row, no participants,
   no event, no email. This is the usual cause.
2. **No recipients.** `getParticipantEmails` returns `[]` and `notify*` returns early
   without logging at `warn`.
3. **Resend rejects the send.** The `Resend` constructor never validates the key, so
   `Resend email client initialized` at boot proves nothing. An invalid key only surfaces
   as a `Failed to send email` error at send time.

To check a key: `curl -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains`.
The `from` domain must also be verified in the Resend account.

## Retry queue

`RetryQueueService` (`src/common/retry/`) persists jobs in Supabase and polls with
exponential backoff — it survives restarts, unlike an in-memory queue. Escrow writes
enqueue a retry when the upstream fails with 5xx; 4xx is rethrown as-is, because retrying
a rejected request just burns quota. Tunables are the `RETRY_QUEUE_*` env vars.

## Testing notes

- 33 suites / 766 tests. Integration suites live in `src/integration/` and build their own
  `Test.createTestingModule`, so they **do not** inherit `AppModule`'s providers. A module
  that a controller needs must be imported there explicitly — `EscrowsController` needs
  `ThrottlerModule.forRoot(...)` or DI fails with "can't resolve ThrottlerGuard".
- `migrated-flows.integration.spec.ts` mocks `@stellar/stellar-sdk`. The mock is partial,
  so any SDK symbol newly used in production code must be added there or it surfaces as a
  confusing 500 instead of a `TypeError`.
