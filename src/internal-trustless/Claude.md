# Trustless Work integration — CLAUDE.md

This module is the **only** place that may hold the Trustless Work (TW) API key. Everything
the browser needs from TW goes through here.

Authoritative reference: the live OpenAPI spec, not the prose docs.
`https://dev.api.trustlesswork.com/docs-json` (mainnet: `https://api.trustlesswork.com/docs-json`).
The narrative docs at docs.trustlesswork.com omit most endpoint paths.

## The contract with TW

- Auth is the **`x-api-key` header** (matches the spec's `securitySchemes`).
- Base URLs: `https://dev.api.trustlesswork.com` (testnet) / `https://api.trustlesswork.com`.
- **Every write returns an unsigned XDR.** Nothing happens on-chain until the correct
  role's wallet signs it and it is submitted through `POST /helper/send-transaction`.
  This is why our write endpoints can authenticate loosely: an unsigned XDR is inert.
- TW's naming is inconsistent and it rejects unknown properties, so parameter names matter:
  - `get-escrows-by-signer` wants **`signer`**, not `address` (sending `address` returns a
    400 `property address should not exist`).
  - `get-escrows-by-role` filters on **`roleAddress`**, not `address`.
  - Roles are **camelCase** upstream (`serviceProvider`), snake_case in our app.
    `EscrowsController.TW_ROLE_MAP` translates; sending `service_provider` makes TW query a
    non-existent field and answer a misleading 500 about a missing index.
- Dispute is split by escrow type: single-release disputes the **whole escrow**
  (`dispute-escrow`, no milestone), multi-release disputes **one milestone**
  (`dispute-milestone`).

## Endpoint coverage

| TW endpoint | Backend relay | Notes |
|---|---|---|
| `POST /deployer/{single,multi}-release` | ✅ | `buildCreateEscrowRequest` |
| `POST /escrow/{type}/fund-escrow` | ✅ | |
| `POST /escrow/single-release/release-funds` | ✅ | |
| `POST /escrow/multi-release/release-milestone-funds` | ✅ | |
| `POST /escrow/{type}/approve-milestone` | ✅ | |
| `POST /escrow/{type}/change-milestone-status` | ✅ | |
| `POST /escrow/single-release/dispute-escrow` | ✅ | |
| `POST /escrow/multi-release/dispute-milestone` | ✅ | |
| `GET /helper/get-escrows-by-signer` | ✅ | `@Public()` |
| `GET /helper/get-escrows-by-role` | ✅ | `@Public()` |
| `POST /helper/send-transaction` | ✅ | |
| `POST /escrow/single-release/resolve-dispute` | ❌ | see below |
| `POST /escrow/multi-release/resolve-milestone-dispute` | ❌ | see below |
| `POST /escrow/{type}/extend-ttl` | ❌ | see below |
| `PUT /escrow/{type}/update-escrow` | ❌ | |
| `POST /escrow/multi-release/withdraw-remaining-funds` | ❌ | |
| `GET /helper/get-escrow-by-contract-ids` | ❌ | |
| `GET /helper/get-multiple-escrow-balance` | ❌ | balances are read from TW list responses |

### Two gaps worth knowing before you touch disputes or long-lived escrows

**Dispute resolution never reaches the chain.** `src/disputes/` resolves a dispute by
updating a Supabase row and emitting an event. It never calls
`resolve-dispute` / `resolve-milestone-dispute`. The app therefore shows a dispute as
resolved while the on-chain escrow is still disputed and the funds stay locked. Closing
this means building the unsigned XDR here, having the dispute resolver's wallet sign it,
and only then writing `status = resolved`.

**Nothing extends the contract TTL.** Soroban archives contract state whose TTL lapses.
TW exposes `extend-ttl` for exactly this and we never call it, so an escrow that sits
unused long enough can become unreachable. There is no scheduled job for it either.

## Why the two reads are `@Public()`

They never bound the address to the JWT user — any authenticated caller could already read
any address — and escrow data is public on-chain. Keeping them guarded only forced the
dashboard to mint an app JWT, which meant a wallet-signature popup before it could list
anything. What protects them now:

- `ThrottlerGuard` at 30 req/min per IP (`@Throttle` on each handler)
- `StrKey.isValidEd25519PublicKey` rejects anything that is not a Stellar public key
- `THALOS_CORS_ORIGIN` restricts browsers (but not non-browser clients)

They still spend our API key, so treat the throttle as a quota guard and lower it if usage
grows. **Never mark a write `@Public()`.**

## Failure handling

`relayWrite` distinguishes upstream 4xx from 5xx: a 4xx is rethrown unchanged (retrying a
rejected request only burns quota), a 5xx is enqueued in the retry queue with an
idempotency key and then rethrown. `formatUpstreamError` unwraps TW's error body so the
client sees the real reason instead of a bare status.

## Known issue outside this module

`ThalosFrontend/services/trustlessworkService.ts` still calls TW **directly from the
browser** for every write (`escrowMigration.ts` keeps those migration flags `false`), using
a hardcoded API key committed to the repo. Migrating each write to this relay is what
removes that exposure — that is the whole point of this module.
