# Thalos Backend — AGENTS.md

> **Partly out of date — see [CLAUDE.md](CLAUDE.md) first.** This file still says the
> project has no tests, no linter and no `.env.example`; all three are wrong (33 Jest
> suites, ESLint + Prettier wired into CI, and `.env.example` is the canonical env list).
> It also predates the Node 22 requirement and the `@Public()` escrow reads.


## Quick start

```bash
pnpm install
pnpm run start:dev   # http://localhost:3001
```

| Command | What |
|---------|------|
| `pnpm run build` | `nest build` → `dist/` |
| `pnpm run start` | `nest start` |
| `pnpm run start:dev` | `nest start --watch` |
| `pnpm run start:prod` | `node dist/main` |

No tests, no linter, no typecheck in the project.

## Env

Variables are read from `.env` (not `.env.example` — that file does not exist). Create `.env` manually with these required vars:

| Var | Notes |
|-----|-------|
| `SUPABASE_URL` | Public project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role** key, not anon |
| `JWT_SECRET` | HS256, must match ThalosFrontend |
| `THALOS_INTERNAL_SECRET` | Shared with Next for `/api/trustless/relay` |
| `TRUSTLESSWORK_API_URL` | Base URL for Trustless Work API |
| `TRUSTLESSWORK_API_KEY` | API key for Trustless Work |
| `RESEND_API_KEY` | Optional — without it email notifications are silently skipped |
| `THALOS_CORS_ORIGIN` | Optional, comma-separated origins |
| `PORT` | Defaults to `3001` |

## API surface

- **Global prefix**: `v1` (set in `main.ts:13`)
- **Swagger UI**: `/v1/docs`
- **OpenAPI JSON**: `/v1/docs-json`
- **Root**: `GET /v1` returns pointer links

### Auth

Two auth schemes in Swagger:

1. **Bearer JWT** (`JwtAuthGuard`) — most endpoints. Uses `passport-jwt` with `HS256` only. `JWT_SECRET` must match the frontend. The `sub` claim is the user ID, injected via `@CurrentUser()` decorator as `{ userId, email? }`.
2. **`x-thalos-internal-secret`** header (`InternalSecretGuard`) — only `POST /v1/internal/trustless/relay`. Matching `THALOS_INTERNAL_SECRET`.

### Module layout

| Dir | Responsibility |
|-----|---------------|
| `agreements/` | CRUD acuerdos in Supabase |
| `agreement-chat/` | Chat per agreement |
| `contacts/` | Contactos (CRUD) |
| `disputes/` | Abrir/asignar/resolver/cancelar |
| `internal-trustless/` | Proxy to Trustless Work API |
| `notifications/` | Email via Resend, event-driven |
| `profiles/` | Profile CRUD |
| `users/` | User search |
| `wallets/` | Wallet CRUD |
| `supabase/` | `SupabaseService` wrapper (service role client) |
| `auth/` | JWT strategy + guard + `@CurrentUser` decorator |
| `common/` | Shared — `ApiClient`, notification event constants |

## Key architecture

- **Supabase**: Uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). Every module calls `supabase.getClient()` directly — no repository layer.
- **ValidationPipe**: global with `whitelist: true`, `transform: true`, `forbidNonWhitelisted: true`.
- **CORS**: from `THALOS_CORS_ORIGIN` (comma-separated) or `true` if unset.
- **Notifications**: `EventEmitter2` in-process. `DisputesService` emits (`dispute.opened`, `dispute.resolved`), `NotificationsService` listens with `@OnEvent`. Event names are constants in `src/common/constants/notification-events.ts`.
- **Trustless relay**: Path allowlist enforced in `InternalTrustlessService`: only `deployer/`, `escrow/`, `helper/` prefixes. Two public endpoints: `POST /v1/trustless/prepare` (JWT) and `POST /v1/internal/trustless/relay` (internal secret).
- **Dist dir is deleted on build**: `nest-cli.json` sets `deleteOutDir: true`.
- **Smoke test**: `smoke-test-backend.ps1` (PowerShell) — requires `-Token`, `-CreatedByWallet`, `-PayeeWallet`. Uses `THALOS_TEST_TOKEN` env var fallback.

## Style / conventions

- No class-validator groups or custom pipes beyond the global `ValidationPipe`.
- All modules are feature-scoped with `Module`, `Controller`, `Service`, `dto/` structure.
- DTOs use `class-validator` + `@nestjs/swagger` decorators.
- No ESLint, Prettier, or any formatting config — run `nest` commands only.
- SQL migrations reference in `scripts/` (e.g. `001_create_user_wallets.sql`). No migration runner.
