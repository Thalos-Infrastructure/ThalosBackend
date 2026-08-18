# Auth contract — Next BFF ↔ Nest API

This is the authoritative description of how ThalosFrontend (the Next.js BFF) and
ThalosBackend (this Nest API) agree on authentication. It covers the app JWT and the
wallet-ownership challenge. If the two services disagree on any line below, **every
authenticated call fails with 401** — so treat this document as the contract, and the
specs listed at the end as its executable form.

## 1. Who does what

| Concern | Owner |
|---|---|
| Minting the app JWT (login, wallet challenge verify) | Next BFF (`ThalosFrontend`) |
| Verifying the app JWT on every request | Nest (`JwtAuthGuard` → `JwtStrategy`) |
| Issuing the wallet-ownership challenge | Nest (`GET /v1/wallets/verification-challenge`) |
| Getting the challenge signed by the wallet | Frontend |
| Verifying the signed challenge | Nest (`POST /v1/wallets`, `POST /v1/wallets/:id/verify`) |

Nest never signs an app JWT. `AuthModule` deliberately does not import `JwtModule`, so the
signing/verifying boundary cannot blur over time.

## 2. App JWT

| Property | Value |
|---|---|
| Type | JWS, compact serialization |
| Algorithm | `HS256` — **the only accepted value** |
| Secret | `SUPABASE_JWT_SECRET` (canonical), falling back to `JWT_SECRET` |
| Transport | `Authorization: Bearer <token>` |
| Required claim | `sub` — the Thalos user id, surfaced as `userId` |
| Optional claims | `email`, plus any BFF-specific claim (ignored, never rejected) |
| Expiry | `exp` is enforced (`ignoreExpiration: false`); the BFF mints 7-day tokens |

The BFF mints the token as:

```ts
jwt.sign({ sub: userId, email }, process.env.SUPABASE_JWT_SECRET, {
  algorithm: 'HS256',
  expiresIn: '7d',
});
```

Nest verifies it in [`src/auth/jwt.strategy.ts`](../src/auth/jwt.strategy.ts) with the same
algorithm and secret, and exposes the result to controllers through `@CurrentUser()`:

```ts
{ userId: payload.sub, email: payload.email }
```

### Rejected (401) in all cases

- signature produced with a different secret;
- `exp` in the past;
- any algorithm other than `HS256` — including `none` and the RSA/EC families;
- payload tampered with after signing;
- no `sub` claim;
- missing, malformed, or non-`Bearer` `Authorization` header.

### Secret resolution

[`src/auth/app-jwt.contract.ts`](../src/auth/app-jwt.contract.ts) is the single place the
secret is read, for both JWT verification and the challenge HMAC:

1. `SUPABASE_JWT_SECRET` — the name the Next BFF signs with; **prefer this**.
2. `JWT_SECRET` — legacy fallback, kept so existing deployments keep booting.

Blank or whitespace-only values count as unset (an empty secret would otherwise silently
become a valid HMAC key), and values are trimmed so a stray newline in a `.env` file cannot
break signature matching. When neither variable holds a value, the app **fails fast at
startup** rather than booting into a state where every request 401s.

Secrets are never logged, echoed in an error body, or included in an exception message —
error text names the *variables*, never their values. A missing secret at request time
surfaces as a generic `500 Server misconfiguration`.

## 3. Wallet-ownership challenge

`GET /v1/wallets/verification-challenge?address=G...` (Bearer JWT required) returns exactly:

```json
{
  "message": "Stellar Signed Message:\nThalos Wallet Ownership Proof\n\n...\nProof: <payload>.<hmac>",
  "expires_at": "2026-01-01T12:05:00.000Z"
}
```

| Field | Type | Meaning |
|---|---|---|
| `message` | string | The SEP-53 envelope to hand to the wallet for signing. Send it back **verbatim** as `signed_message`. |
| `expires_at` | string | ISO-8601 UTC instant (`YYYY-MM-DDTHH:mm:ss.sssZ`). TTL is 5 minutes. |

These are the names the frontend reads; they are pinned by
`src/wallets/verification-challenge.contract.spec.ts` and typed by
`VerificationChallengeResponseDto` (so they also appear in Swagger at `/v1/docs`).

`message` is built as:

```
Stellar Signed Message:
Thalos Wallet Ownership Proof

I authorize linking this wallet to my Thalos account.
Account: <userId>
Wallet: <address>
Nonce: <32 hex chars>
Issued At: <ISO-8601>
Expires At: <ISO-8601>

Proof: <base64url(payload)>.<base64url(HMAC-SHA256(payload))>
```

The `Proof:` line is server-only metadata appended **after** the HMAC is computed, so it
never influences the bytes the wallet signs; Nest strips it again before verifying the
Ed25519 signature. The HMAC uses the same secret as the app JWT (section 2), which is why
issuing and verifying a challenge can never drift onto different keys.

Sending the challenge back:

```http
POST /v1/wallets/:id/verify
Authorization: Bearer <app JWT>

{ "wallet_address": "G...", "signed_message": "<message verbatim>", "signature": "<base64url>" }
```

Nest checks, in order: the HMAC proof, that `sub` matches the caller and `addr` matches the
wallet, that `exp` has not passed, and finally the Ed25519 signature (SEP-53 hashed form,
with the pre-SEP-53 raw-bytes form still accepted so wallets linked earlier keep verifying).

## 4. Internal service auth (for contrast)

Server-to-server routes (`POST /v1/internal/...`) use the `x-thalos-internal-secret` header
matched against `THALOS_INTERNAL_SECRET`. It is a separate mechanism, only for the Next
server, and is never a substitute for the app JWT on user-facing routes.

## 5. Executable form of this contract

| Spec | Pins |
|---|---|
| `src/auth/next-bff-jwt.integration.spec.ts` | Real HTTP: a Next-minted token is accepted; wrong secret / expired / `HS512` / `none` / tampered / no `sub` / malformed / missing header are all 401 |
| `src/auth/app-jwt.contract.spec.ts` | Secret resolution order, blank/whitespace handling, fail-fast, no secret in error text |
| `src/auth/jwt.strategy.spec.ts` | Payload → `{ userId, email }` mapping and rejection cases |
| `src/wallets/verification-challenge.contract.spec.ts` | `{ message, expires_at }` field names, ISO-8601 expiry, 5-minute TTL, per-call nonce, issue → verify round trip |

Run them with:

```bash
pnpm jest src/auth src/wallets
```
