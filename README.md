# Thalos Backend (NestJS)

API layer for the [Thalos](https://github.com/Thalos-Infrastructure) escrow orchestration platform. It handles agreements, contacts, profile search, disputes, email notifications, and an **internal relay to Trustless Work** that keeps the Trustless Work API key on the server (it never reaches the browser).

> Thalos is an escrow orchestration layer on the **Stellar** network, connected to the **Trustless Work** protocol. The user always signs transactions client-side; this backend only adds the server-side API key and forwards requests — it never custodies keys or funds.

## Tech stack

- **NestJS 11** + TypeScript
- **Supabase** (`@supabase/supabase-js`) for data access (Postgres)
- **Passport JWT** for app authentication
- **class-validator / class-transformer** for input validation (DTOs)
- **Swagger** (`@nestjs/swagger`) for interactive API docs
- **Resend** for transactional emails

## Requirements

- Node.js 20+
- pnpm (recommended) or npm
- A Supabase project with the tables used by the platform (`agreements`, `agreement_participants`, `agreement_activity`, `profiles`, `contacts`, `auth_users`, `disputes`, `dispute_resolutions`, …)

## Environment variables

Copy [`.env.example`](.env.example) to `.env.local` and fill in real values. `.env` / `.env.local` are gitignored and must never be committed.

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Secret used to verify the app JWT (HS256). **Must be identical** to the frontend's `JWT_SECRET`, or tokens are rejected with 401. |
| `SUPABASE_URL` | Yes | Supabase project URL (same project the frontend uses). |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key. Server-side only — full DB access, keep secret. |
| `THALOS_INTERNAL_SECRET` | Yes | Shared secret for the internal Next.js → Nest relay (`x-thalos-internal-secret`). Must match the frontend's value. |
| `TRUSTLESSWORK_API_URL` | For escrow ops | Base URL of the Trustless Work API. |
| `TRUSTLESSWORK_API_KEY` | For escrow ops | Trustless Work API key, injected server-side by the relay. **Never expose to the browser.** |
| `TRUSTLESS_WORK_WEBHOOK_SECRET` | For TW webhooks | HMAC secret to verify incoming Trustless Work webhook calls (`x-trustless-signature`). If unset, all webhook requests are rejected with 401. |
| `STELLAR_NETWORK` | No | Stellar network: `testnet` (default) or `mainnet`. |
| `PLATFORM_ADDRESS` | No | Platform address used when creating escrows. Has a testnet default. |
| `DISPUTE_RESOLVER` | No | Dispute resolver address used when creating escrows. Has a testnet default. |
| `TRUSTLINE_USDC_ADDRESS` | No | USDC trustline address used when creating escrows. Has a testnet default. |
| `RESEND_API_KEY` | For emails | Resend API key. If unset, email notifications are disabled (logged, non-fatal). |
| `PORT` | No | HTTP port. Defaults to **3001**. |
| `THALOS_CORS_ORIGIN` | No | Comma-separated list of allowed CORS origins. Defaults to allowing all. In production include the frontend origin (e.g. `https://www.thalosplatform.xyz`). |
| `THALOS_APP_PUBLIC_URL` | No | Public frontend URL used to build links in outgoing emails. Falls back to the first `THALOS_CORS_ORIGIN`, then `http://localhost:3000`. |

## Getting started

```bash
pnpm install
pnpm run start:dev   # watch mode
```

The server listens on port **3001** by default with a global `v1` prefix.

- **Swagger UI:** `http://localhost:3001/v1/docs`
- **OpenAPI JSON:** `http://localhost:3001/v1/docs-json`
- **API root (pointers):** `GET http://localhost:3001/v1`

### Scripts

| Command | Description |
|---|---|---|
| `pnpm run start:dev` | Start in watch mode (development) |
| `pnpm run start` | Start without watch |
| `pnpm run build` | Compile to `dist/` |
| `pnpm run start:prod` | Run the compiled build (`node dist/main`) |

There is also a `smoke-test-backend.ps1` PowerShell script for a quick end-to-end check.

## Architecture

```
Browser (wallet signs client-side)
   │
   ▼
Next.js  ──/api/* (server)──►  NestJS (v1/*)  ──►  Supabase (Postgres)
   │                                │
   └──internal relay───────────────►└──► Trustless Work API (x-api-key, server only)
```

- **Feature modules** live under `src/<feature>/`, each with `*.module.ts`, `*.controller.ts`, `*.service.ts`, and `dto/`.
- **Controllers are thin:** they route, apply guards, extract the user via `@CurrentUser()`, and translate the service result into HTTP responses. Business logic lives in the **service**.
- **Data access** always goes through `SupabaseService.getClient()`, injected into the service constructor.
- **Authorization** is enforced in services before touching data (e.g. `assertActorWallet`, `assertCanAccessAgreement`): the wallet from the JWT must match the actor and be a participant of the resource.
- **Recoverable errors:** services return `{ data, error }` and the controller decides the HTTP status; non-critical failures (activity logs, emails) are swallowed and logged so they don't break the main flow.

### Global configuration (`src/main.ts`)

- Global prefix `v1`.
- Global `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform` — **every accepted field must be declared in a DTO**, or the request is rejected.
- CORS configurable via `THALOS_CORS_ORIGIN`.
- Swagger with two auth schemes: `bearer` (app JWT) and `thalos-internal` (internal relay header).

### Modules

| Module | Responsibility |
|---|---|
| `auth` | JWT strategy, `JwtAuthGuard`, `@CurrentUser()` decorator |
| `supabase` | Singleton Supabase client (`SupabaseService`) |
| `agreements` | Agreement CRUD, milestones, status, activity log |
| `agreement-chat` | Per-agreement chat messages |
| `contacts` | User contacts |
| `disputes` | Dispute lifecycle (open, assign resolver, resolve, cancel) |
| `profiles` / `users` | Profile data and user search |
| `wallets` | Wallet linking |
| `notifications` | Resend-based email notifications + HTML templates |
| `internal-trustless` | Relay to Trustless Work + typed escrow read endpoints |

## Authentication & security

Two independent mechanisms:

1. **App JWT (`Bearer`)** — protects user-facing routes via `JwtAuthGuard`. The token must be signed with `JWT_SECRET` (HS256), unexpired, and carry a `sub` claim. Issued by the frontend on login.
2. **Internal secret (`x-thalos-internal-secret`)** — protects server-to-server routes via `InternalSecretGuard`. Intended only for the Next.js server, never the browser.

The browser must call the Next.js frontend (`/api/...`), which forwards to this backend — this keeps secrets server-side and avoids CORS issues.

## Main routes

| Route | Auth | Description |
|---|---|---|
| `GET /v1` | — | API root / pointers |
| `POST /v1/trustless/prepare` | Bearer JWT | Relay to Trustless Work; returns the upstream `{ status, data }` (e.g. `{ unsignedTransaction }` to sign client-side) |
| `POST /v1/internal/trustless/relay` | Internal secret | Same relay, for the Next.js server only |
| `GET /v1/escrows/by-signer/:address` | Bearer JWT | Escrows where the address is a signer |
| `GET /v1/escrows/by-role` | Bearer JWT | Escrows filtered by role/status/type |
| `POST /v1/escrows/{create,fund,approve-milestone,change-milestone-status,release,dispute}` | Bearer JWT | Escrow writes; return an `unsignedTransaction` to sign client-side. Enforce that the signer matches the JWT wallet |
| `POST /v1/escrows/send-transaction` | Bearer JWT | Submit the already-signed XDR to the network |
| `GET\|POST\|PATCH /v1/agreements/*` | Bearer JWT | Agreement CRUD, milestones, status, activity |
| `GET\|POST\|PATCH /v1/disputes/*` | Bearer JWT | Dispute lifecycle |
| `GET /v1/users/search` | Bearer JWT | Profile search |
| `GET\|POST\|DELETE /v1/contacts` | Bearer JWT | Contacts |
| `POST /v1/internal/notifications/*` | Internal secret | Trigger transactional emails |

The Trustless Work relay only allows paths under `deployer/`, `escrow/`, and `helper/`.

> Tip: in Swagger UI (`/v1/docs`), use **Authorize** to paste a JWT and try the protected routes without building the curl by hand.

## Database & migrations

SQL migrations live under [`scripts/`](scripts). Apply them to the Supabase project before running the API.

## Notifications (EventEmitter2)

Transactional email notifications are wired through in-process **EventEmitter2** events — no direct coupling between modules.

- `DisputesService.openDispute()` emits `dispute.opened` → `NotificationsService.handleDisputeOpened()` looks up agreement title + opener name and sends email
- `DisputesService.resolveDispute()` emits `dispute.resolved` → `NotificationsService.handleDisputeResolved()` calculates refund/release amounts and sends email

Event name constants live in `src/common/constants/notification-events.ts` (single source of truth, no string literals).

If `RESEND_API_KEY` is not set, emails are skipped with a warning log — the originating action is never blocked.

## Docs

- [`docs/SCOPE.md`](docs/SCOPE.md) — closed scope decisions.
- [`docs/EMAIL_NOTIFICATIONS_PLAN.md`](docs/EMAIL_NOTIFICATIONS_PLAN.md) — event-driven email notifications plan (epic + tickets).
