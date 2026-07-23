# Thalos Backend — Performance & Load Testing Suite

Load & performance suite for the **Agreement API**, kept **separate from the Jest
unit/integration suites**. It is not a pass/fail CI gate — its job is to establish
a documented performance **baseline** for future comparison (issue #70).

Tool: [`autocannon`](https://github.com/mcollina/autocannon) — pure Node, no
external binary, programmatic API.

## Layout

```
test/load/
  config.js            # env-driven config (target, JWT, knobs)
  run-all.js           # orchestrator → runs all scenarios, writes report
  scenarios.js         # create / read / update / activity / burst / list
  seed.js              # standalone dataset seeder (500 / 1000)
  mock/server.js       # in-memory Agreement API (default local target)
  lib/
    http.js            # fetch helpers (create/seed/health)
    resource-sampler.js# CPU/RSS sampler for the target process
    report.js          # JSON + Markdown report generator
  reports/             # generated baselines (BASELINE.md = latest)
```

## Run it

```bash
# Full suite against the local in-memory mock (default), writes reports/BASELINE.md
pnpm test:load

# Just the mock server (e.g. to point another tool at it)
pnpm test:load:mock

# Seed a dataset only
pnpm test:load:seed 1000
```

### Against staging (never production)

Point the same scripts at a staging instance and provide a seeded JWT:

```bash
THALOS_TARGET_URL="https://staging.thalos.example" \
LOAD_TEST_JWT="<jwt-for-a-seeded-test-user>" \
LOAD_TEST_WALLET="G...TESTNET_WALLET" \
pnpm test:load
```

- The seeded user must exist in `auth_users` with `wallet_public_key = LOAD_TEST_WALLET`
  (a **testnet** wallet).
- `LOAD_TEST_JWT` lets you run without knowing `JWT_SECRET`. Alternatively set
  `JWT_SECRET` and a token is minted for you.
- Resource (CPU/RSS) sampling only works for a local process; for staging, read
  CPU/memory from the hosting platform's metrics — the report marks these `n/a`.

## Knobs (env)

| Var | Default | Meaning |
|---|---|---|
| `THALOS_TARGET_URL` | local mock | Base URL under test |
| `LOAD_CONNECTIONS` | `100` | Concurrent users |
| `LOAD_DURATION` | `20` | Seconds per scenario |
| `LOAD_DATASET_SMALL` / `LOAD_DATASET_LARGE` | `500` / `1000` | Dataset sizes |
| `LOAD_SIM_DB_LATENCY_MS` | `4` | Mock's simulated Supabase latency |
| `LOAD_TEST_JWT` | — | Pre-seeded token (staging) |

## Scenarios & metrics

Scenarios: **create**, **read**, **update**, **activity** (feed read), **burst**
(3× connections, pipelined), and **list_500 / list_1000** (dataset-size sensitivity).
Concurrent creation and concurrent updates are covered by `create` and `update`;
activity-logging throughput is reflected by `create`/`update` (each writes an
activity row) plus the `activity` read.

Captured per scenario: **avg response time, p50/p99, peak latency, throughput
(req/s), failure rate, and CPU/RSS** (local target).

## Why this is isolated from CI

- Jest's `rootDir` is `src/` and only matches `*.spec.ts`; this suite is `*.js`
  under `test/load/`, so Jest never picks it up. `jest.config.js` also lists it in
  `testPathIgnorePatterns` explicitly.
- These runs are long and environment-dependent — trigger them **manually** (or in
  a dedicated workflow), never in the default `jest` CI job.

## Trustless Work isolation

The Agreement **create/update** path writes to Supabase and emits **in-process**
events; it does **not** call Trustless Work synchronously. So load on
`/v1/agreements/*` reflects Thalos, not TW rate limits — no TW mocking is required
for these scenarios. (If future listeners add synchronous outbound TW calls, point
`TRUSTLESSWORK_API_URL` at a stub before load testing.)
