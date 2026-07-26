# ThalosBackend — CLAUDE.md

NestJS API for Thalos. Owns Supabase persistence (agreements, profiles, wallets), a
secure server-side **relay to the Trustless Work (TW) escrow API**, notifications
(Resend), and TW webhooks. HTTP prefix `/v1`; Swagger at `/v1/docs`.

## Runtime & commands

- **Node 22 required** (NOT Node 20). `@supabase/supabase-js` (realtime) needs native
  `WebSocket`, absent in Node 20 → the app crashes on boot with
  "Node.js 20 detected without native WebSocket support". The repo `.nvmrc` says `20`
  but is **stale**; `package.json` engines is `>=20`. Node 22 lives at
  `C:\Users\leandro.masotti\AppData\Local\nvm\v22.23.1` (prepend to PATH; the global
  default is still Node 20).
- Package manager: **pnpm** (`packageManager: pnpm@10.11.0`).
- Install: `pnpm install`
- Dev: `pnpm start:dev` → http://localhost:3001 (watch mode)
- Test: `pnpm test` · integration: `pnpm test:integration`
- Lint: `pnpm lint` (eslint --fix) · Build: `pnpm build`

## Environment

Copy `.env.example` → `.env.local` (values in the example are working dev secrets).
Key vars: `JWT_SECRET` (HS256; **must be identical to the frontend's**),
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, `TRUSTLESSWORK_API_URL` +
`TRUSTLESSWORK_API_KEY` (server-only), `THALOS_INTERNAL_SECRET` (must match frontend),
`RESEND_API_KEY`, `PORT` (3001), `THALOS_CORS_ORIGIN` (http://localhost:3000).
Supabase project ref: `cpkjclwvgnxgadiaoaei`.

## Architecture

- **Auth (`src/auth/`)** — the backend only *validates* JWTs; it never signs them
  (token signing is the frontend's responsibility — see `auth.module.ts`). `JwtStrategy`
  verifies HS256 with `JWT_SECRET`; payload is `{ sub, email? }`; `validate()` returns
  `req.user = { userId: sub, email }`. Use `@UseGuards(JwtAuthGuard)` + `@CurrentUser()`.
- **Trustless Work relay (`src/internal-trustless/`)** — `relayToTrustless(method, path, query?, body?)`
  in `trustless-relay.helper.ts` forwards to `TRUSTLESSWORK_API_URL` with the server-side
  `x-api-key` header. Paths are allow-listed (`deployer/`, `escrow/`, `helper/`).
  `escrows.controller.ts` exposes the escrow endpoints (class is `@UseGuards(JwtAuthGuard)`).
  - ⚠️ **TW query param names matter** (confirmed against https://api.trustlesswork.com/docs):
    `helper/get-escrows-by-signer` takes **`signer`** (rejects `role`/`roleAddress`);
    `helper/get-escrows-by-role` takes **`roleAddress` + `role`** (rejects `signer`).
    Sending `address` to either → TW 400 "property address should not exist". Also valid:
    `page`, `pageSize` (TW default 8), `validateOnChain`, `status`, `type`.
  - ⚠️ **TW `role` values are camelCase** (`serviceProvider`, `releaseSigner`, `disputeResolver`).
    The controller normalizes snake_case → camelCase; sending `service_provider` makes TW return a
    misleading `500 "query requires an index"` (it queries a non-existent `roles.service_provider`).
  - Read endpoints (`by-signer`, `by-role`) require *any* valid JWT but ignore identity.
    Write endpoints (`create`, `fund`, `approve-milestone`, …) call
    `assertSignerWallet(user.userId, dto.signer)` → looks up `auth_users.wallet_public_key`
    by `id = userId` and requires it to equal the signer.
- **Supabase (`src/supabase/`)** — `SupabaseService.getClient()` uses the service-role key.
  Tables: `auth_users` (`id` = JWT `sub`, has `wallet_public_key`), `profiles` (keyed by
  `wallet_address`, has `role`/`account_type`), `user_wallets` (linked wallets).
  Note `auth_users.id ≠ profiles.id`; they join via wallet address.
- **Wallet signature verification (`src/wallets/helpers/stellar-verification.helper.ts`)** —
  `verifyStellarSignature`, `parseAndVerifyChallenge`, `generateVerificationChallenge`
  (stateless HMAC proof + 5-min TTL; no nonce store). Used for wallet linking/verification.

## Conventions

- No cache/Redis; transient tokens use the stateless HMAC-proof pattern.
- `@nestjs/jwt` is a dependency but unused (no signing here). `jsonwebtoken` is test-only.
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` + `transform`.
