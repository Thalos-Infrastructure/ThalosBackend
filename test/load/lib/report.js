'use strict';

/**
 * Turns raw autocannon results (+ resource samples) into:
 *   - a machine-readable JSON blob, and
 *   - a human-readable Markdown baseline report.
 *
 * Metrics captured per scenario, as required by the issue:
 *   avg response time, peak latency, failure rate, throughput, CPU/memory.
 */

const fs = require('fs');
const path = require('path');

/** Normalize one autocannon result into our scenario metric shape. */
function summarize(name, description, result, resources) {
  const completed = result.requests?.total ?? 0; // requests that got a response
  const non2xx = result.non2xx ?? 0; // completed but non-2xx
  const errors = result.errors ?? 0; // connection/socket errors
  const timeouts = result.timeouts ?? 0; // never completed
  // Attempts include requests that never completed (errors/timeouts), so the
  // failure rate can't exceed 100%.
  const attempts = completed + errors + timeouts;
  const failures = non2xx + errors + timeouts;
  return {
    scenario: name,
    description,
    connections: result.connections,
    durationSec: result.duration,
    requestsAttempted: attempts,
    requestsCompleted: completed,
    throughputReqSec: round(result.requests?.mean ?? 0),
    avgLatencyMs: round(result.latency?.mean ?? 0),
    p50LatencyMs: round(result.latency?.p50 ?? 0),
    p99LatencyMs: round(result.latency?.p99 ?? 0),
    peakLatencyMs: round(result.latency?.max ?? 0),
    non2xx,
    errors,
    timeouts,
    failures,
    failureRatePct: attempts ? round((failures / attempts) * 100) : 0,
    resources: resources || { available: false },
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function toMarkdown(meta, scenarios) {
  const lines = [];
  lines.push('# Thalos Backend — Performance & Load Testing Baseline');
  lines.push('');
  lines.push(`- **Generated:** ${meta.generatedAt}`);
  lines.push(`- **Target:** \`${meta.target}\` ${meta.isLocalMock ? '(local mock)' : '(remote)'}`);
  lines.push(`- **Tool:** autocannon v${meta.autocannonVersion}`);
  lines.push(`- **Node:** ${meta.node} · **Platform:** ${meta.platform}`);
  lines.push(
    `- **Defaults:** ${meta.connections} concurrent connections · ${meta.duration}s per scenario`,
  );
  lines.push('');
  if (meta.isLocalMock) {
    lines.push(
      '> ⚠️ These numbers were produced against the **local in-memory mock** ' +
        '(`test/load/mock/server.js`), not staging. They prove the suite runs end-to-end ' +
        'and give a reproducible local baseline. Re-run against staging by setting ' +
        '`THALOS_TARGET_URL` to publish official staging numbers.',
    );
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(
    '| Scenario | Reqs | Throughput (req/s) | Avg (ms) | p99 (ms) | Peak (ms) | Failure % | CPU peak % | RSS peak (MB) |',
  );
  lines.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|');
  for (const s of scenarios) {
    const r = s.resources;
    const cpu = r.available ? r.cpuPeakPct : 'n/a';
    const rss = r.available ? r.rssPeakMb : 'n/a';
    lines.push(
      `| ${s.scenario} | ${s.requestsAttempted} | ${s.throughputReqSec} | ${s.avgLatencyMs} | ${s.p99LatencyMs} | ${s.peakLatencyMs} | ${s.failureRatePct} | ${cpu} | ${rss} |`,
    );
  }
  lines.push('');

  lines.push('## Scenario detail');
  lines.push('');
  for (const s of scenarios) {
    lines.push(`### ${s.scenario}`);
    lines.push('');
    lines.push(`${s.description}`);
    lines.push('');
    lines.push(`- Connections (concurrent users): **${s.connections}**`);
    lines.push(`- Duration: **${s.durationSec}s**`);
    lines.push(`- Requests attempted: **${s.requestsAttempted}** (completed ${s.requestsCompleted})`);
    lines.push(`- Throughput: **${s.throughputReqSec} req/s**`);
    lines.push(
      `- Latency — avg **${s.avgLatencyMs}ms**, p50 **${s.p50LatencyMs}ms**, p99 **${s.p99LatencyMs}ms**, peak **${s.peakLatencyMs}ms**`,
    );
    lines.push(
      `- Failures: **${s.failures}** (${s.failureRatePct}%) — non-2xx ${s.non2xx}, errors ${s.errors}, timeouts ${s.timeouts}`,
    );
    if (s.resources.available) {
      lines.push(
        `- Resources — CPU avg ${s.resources.cpuAvgPct}% / peak ${s.resources.cpuPeakPct}%, ` +
          `RSS avg ${s.resources.rssAvgMb}MB / peak ${s.resources.rssPeakMb}MB (${s.resources.samples} samples)`,
      );
    } else {
      lines.push(
        '- Resources — n/a (remote target; read CPU/memory from the hosting platform metrics)',
      );
    }
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- This suite lives under `test/load/` and is **excluded from the Jest CI job** ' +
      '(Jest `rootDir` is `src/` and only matches `*.spec.ts`). Run it manually with `pnpm test:load`.',
  );
  lines.push(
    '- Outbound Trustless Work calls are not exercised: the Agreement create/update path ' +
      'writes to Supabase and emits in-process events; it does not call TW synchronously. ' +
      'So these numbers reflect Thalos, not TW rate limits.',
  );
  lines.push('');
  return lines.join('\n');
}

function writeReport(outDir, meta, scenarios) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = meta.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `baseline-${stamp}.json`);
  const mdPath = path.join(outDir, `baseline-${stamp}.md`);
  const latestMd = path.join(outDir, 'BASELINE.md');

  fs.writeFileSync(jsonPath, JSON.stringify({ meta, scenarios }, null, 2));
  const md = toMarkdown(meta, scenarios);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(latestMd, md);
  return { jsonPath, mdPath, latestMd };
}

module.exports = { summarize, toMarkdown, writeReport };
