# `GET /v1/agreements` — filtered agreement listing

Nest is the source of truth for agreement listing. The frontend's
`getAgreements({ status, type })` calls this endpoint directly.

## Contract

```http
GET /v1/agreements?status=<status>&type=<type>
Authorization: Bearer <app JWT>
```

| Query param | Required | Values | Meaning |
|---|---|---|---|
| `status` | no | `draft` · `pending` · `funded` · `active` · `in_review` · `completed` · `disputed` · `resolved` · `cancelled` | Filter on `agreements.status`. |
| `type` | no | `single` · `multi` · `standard` · `bounty` | Filter on `agreements.agreement_type`. `standard` / `bounty` are legacy values kept filterable. |

Both params are optional and combine with AND. A blank value (`?status=&type=`)
means "no filter" — that is the shape a filter UI sends before anything is
picked. An unknown value, or any query param that is not `status` / `type`, is a
`400` from the global `ValidationPipe`.

### Response — 200

The same `{ agreements, error }` envelope as `POST /v1/agreements` and
`GET /v1/agreements/:id`, with full agreement rows ordered by `created_at`
descending:

```json
{
  "agreements": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "contract_id": "CB…",
      "title": "Soroban audit",
      "description": "Full audit of the escrow contract",
      "amount": "1500.00",
      "asset": "USDC",
      "status": "active",
      "agreement_type": "multi",
      "milestones": [{ "description": "Phase 1", "amount": "750.00", "status": "approved" }],
      "metadata": {},
      "created_by": "G…",
      "created_at": "2026-06-01T00:00:00.000Z",
      "updated_at": "2026-06-02T00:00:00.000Z",
      "funded_at": "2026-06-01T12:00:00.000Z",
      "completed_at": null
    }
  ],
  "error": null
}
```

### Other responses

| Case | Response |
|---|---|
| No matching agreements | `200 { "agreements": [], "error": null }` |
| Caller has no linked wallet | `200 { "agreements": [], "error": null }` |
| Supabase read fails | `200 { "agreements": [], "error": "<message>" }` |
| Missing / invalid JWT | `401` |
| Unknown filter value or unknown query param | `400` |

Read failures stay inside the envelope rather than throwing, which is how the
other agreement reads behave — the frontend checks `error` before `agreements`.

## Scoping

Results cover every agreement the authenticated user **created** or
**participates in**, resolved across *all* wallets they own
(`user_wallets`, plus the legacy `auth_users.wallet_public_key` fallback — see
`src/common/wallets/resolve-user-wallets.ts`). Switching wallets in the UI does
not change what this endpoint returns.

A user with no linked wallet lists empty instead of `403`: having nothing to show
is not an authorization failure. `GET /v1/agreements/by-wallet` still rejects,
because there the caller names a specific wallet and must prove it owns it.

## Indexes

`scripts/018_agreements_filter_indexes.sql` covers the scoping columns
(`agreements.created_by`, `agreement_participants.wallet_address`), the two
filter columns, the `(status, agreement_type)` pair, and `created_at DESC` for
the ordering.
