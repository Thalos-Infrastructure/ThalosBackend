# Thalos Backend — Performance & Load Testing Baseline

- **Generated:** 2026-07-23T14:26:02.580Z
- **Target:** `http://127.0.0.1:4599` (local mock)
- **Tool:** autocannon v8.0.0
- **Node:** v20.19.5 · **Platform:** darwin/x64
- **Defaults:** 100 concurrent connections · 20s per scenario

> ⚠️ These numbers were produced against the **local in-memory mock** (`test/load/mock/server.js`), not staging. They prove the suite runs end-to-end and give a reproducible local baseline. Re-run against staging by setting `THALOS_TARGET_URL` to publish official staging numbers.

## Summary

| Scenario | Reqs | Throughput (req/s) | Avg (ms) | p99 (ms) | Peak (ms) | Failure % | CPU peak % | RSS peak (MB) |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| create | 22803 | 1140.16 | 87.18 | 157 | 1685 | 0 | 114.6 | 107.29 |
| read | 19185 | 959.25 | 103.98 | 281 | 2860 | 0 | 106.5 | 115.36 |
| update | 19618 | 980.9 | 101.17 | 300 | 2392 | 0 | 113.4 | 120.27 |
| activity | 21023 | 1051.16 | 94.64 | 215 | 3931 | 0 | 100 | 114.69 |
| burst | 5538 | 1107.6 | 313.43 | 3606 | 4919 | 0 | 101.2 | 118.03 |
| list_500 | 13836 | 691.8 | 143.68 | 515 | 7837 | 0 | 106.1 | 122.58 |
| list_1000 | 11418 | 570.9 | 174.22 | 334 | 6179 | 0 | 103.9 | 100.29 |

## Scenario detail

### create

Concurrent Agreement creation (POST /agreements) — also activity-write throughput.

- Connections (concurrent users): **100**
- Duration: **20.05s**
- Requests attempted: **22803** (completed 22803)
- Throughput: **1140.16 req/s**
- Latency — avg **87.18ms**, p50 **77ms**, p99 **157ms**, peak **1685ms**
- Failures: **0** (0%) — non-2xx 0, errors 0, timeouts 0
- Resources — CPU avg 99.35% / peak 114.6%, RSS avg 88.29MB / peak 107.29MB (40 samples)

### read

Single Agreement read (GET /agreements/:id).

- Connections (concurrent users): **100**
- Duration: **20.1s**
- Requests attempted: **19185** (completed 19185)
- Throughput: **959.25 req/s**
- Latency — avg **103.98ms**, p50 **86ms**, p99 **281ms**, peak **2860ms**
- Failures: **0** (0%) — non-2xx 0, errors 0, timeouts 0
- Resources — CPU avg 82.6% / peak 106.5%, RSS avg 114.99MB / peak 115.36MB (40 samples)

### update

Concurrent Agreement status updates (PATCH /agreements/:id/status).

- Connections (concurrent users): **100**
- Duration: **20.02s**
- Requests attempted: **19618** (completed 19618)
- Throughput: **980.9 req/s**
- Latency — avg **101.17ms**, p50 **93ms**, p99 **300ms**, peak **2392ms**
- Failures: **0** (0%) — non-2xx 0, errors 0, timeouts 0
- Resources — CPU avg 89.89% / peak 113.4%, RSS avg 115.61MB / peak 120.27MB (39 samples)

### activity

Activity feed read (GET /agreements/:id/activity).

- Connections (concurrent users): **100**
- Duration: **20.04s**
- Requests attempted: **21023** (completed 21023)
- Throughput: **1051.16 req/s**
- Latency — avg **94.64ms**, p50 **73ms**, p99 **215ms**, peak **3931ms**
- Failures: **0** (0%) — non-2xx 0, errors 0, timeouts 0
- Resources — CPU avg 88.99% / peak 100%, RSS avg 114.4MB / peak 114.69MB (39 samples)

### burst

Burst traffic: 3x connections, pipelined, short window (read spike).

- Connections (concurrent users): **300**
- Duration: **5.06s**
- Requests attempted: **5538** (completed 5538)
- Throughput: **1107.6 req/s**
- Latency — avg **313.43ms**, p50 **225ms**, p99 **3606ms**, peak **4919ms**
- Failures: **0** (0%) — non-2xx 0, errors 0, timeouts 0
- Resources — CPU avg 95.36% / peak 101.2%, RSS avg 117.1MB / peak 118.03MB (10 samples)

### list_500

List by wallet against a 500-agreement dataset.

- Connections (concurrent users): **100**
- Duration: **20.04s**
- Requests attempted: **13836** (completed 13836)
- Throughput: **691.8 req/s**
- Latency — avg **143.68ms**, p50 **112ms**, p99 **515ms**, peak **7837ms**
- Failures: **0** (0%) — non-2xx 0, errors 0, timeouts 0
- Resources — CPU avg 88.28% / peak 106.1%, RSS avg 100.1MB / peak 122.58MB (39 samples)

### list_1000

List by wallet against a 1000-agreement dataset.

- Connections (concurrent users): **100**
- Duration: **20.08s**
- Requests attempted: **11418** (completed 11418)
- Throughput: **570.9 req/s**
- Latency — avg **174.22ms**, p50 **160ms**, p99 **334ms**, peak **6179ms**
- Failures: **0** (0%) — non-2xx 0, errors 0, timeouts 0
- Resources — CPU avg 98.5% / peak 103.9%, RSS avg 92.4MB / peak 100.29MB (39 samples)

## Notes

- This suite lives under `test/load/` and is **excluded from the Jest CI job** (Jest `rootDir` is `src/` and only matches `*.spec.ts`). Run it manually with `pnpm test:load`.
- Outbound Trustless Work calls are not exercised: the Agreement create/update path writes to Supabase and emits in-process events; it does not call TW synchronously. So these numbers reflect Thalos, not TW rate limits.
