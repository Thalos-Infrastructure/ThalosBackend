'use strict';

/**
 * Orchestrates the full load-testing suite and writes a baseline report.
 *
 *   pnpm test:load                      # local mock, default knobs
 *   THALOS_TARGET_URL=https://staging.. LOAD_TEST_JWT=... pnpm test:load
 *
 * Steps:
 *   1. Start the local mock (unless THALOS_TARGET_URL points elsewhere).
 *   2. Wait for health, create a base agreement for read/update/activity.
 *   3. Run each scenario while sampling target CPU/RSS (local only).
 *   4. Seed 500 / 1000 datasets and run list scenarios at each size.
 *   5. Write JSON + Markdown baseline under test/load/reports/.
 */

const path = require('path');
const { fork } = require('child_process');
const autocannonPkg = require('autocannon/package.json');

const cfg = require('./config');
const scenarios = require('./scenarios');
const { waitForHealth, createAgreement, seedAgreements } = require('./lib/http');
const { startIpcSampling } = require('./lib/resource-sampler');
const { summarize, writeReport } = require('./lib/report');

/** Guard against a dead/unresponsive mock hanging an IPC round-trip forever. */
const IPC_TIMEOUT_MS = Number(process.env.LOAD_IPC_TIMEOUT_MS) || 15000;

async function withSampling(mock, fn) {
  // Sample the mock over IPC (cross-platform). For remote targets `mock` is
  // null, so the sampler is a no-op and resources are reported as unavailable.
  const sampler = startIpcSampling(mock);
  try {
    const result = await fn();
    const resources = await sampler.stop();
    return { result, resources };
  } catch (err) {
    await sampler.stop();
    throw err;
  }
}

/**
 * Await a single tagged IPC reply from the mock, rejecting after IPC_TIMEOUT_MS
 * so a dead mock can never hang the whole run.
 */
function ipcRequest(mock, message, replyType) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mock.off('message', onMsg);
      reject(new Error(`IPC "${message.cmd}" timed out after ${IPC_TIMEOUT_MS}ms`));
    }, IPC_TIMEOUT_MS);
    const onMsg = (msg) => {
      if (!msg || !msg.ok || msg.type !== replyType) return;
      clearTimeout(timer);
      mock.off('message', onMsg);
      resolve(msg);
    };
    mock.on('message', onMsg);
    mock.send(message, (err) => {
      if (err) {
        clearTimeout(timer);
        mock.off('message', onMsg);
        reject(err);
      }
    });
  });
}

/** Seed via IPC when we own the mock process; fall back to HTTP for remote. */
async function seedViaIpc(mock, count) {
  const msg = await ipcRequest(mock, { cmd: 'seed', count }, 'seeded');
  return msg.size;
}

/** Run one scenario resiliently: a failure is recorded, never fatal. */
async function runScenario(collector, mock, name, desc, fn) {
  log(`Running scenario: ${name} ...`);
  try {
    const { result, resources } = await withSampling(mock, fn);
    collector.push(summarize(name, desc, result, resources));
  } catch (err) {
    log(`  scenario "${name}" errored: ${err.message} — recording and continuing`);
    collector.push(summarize(name, `${desc} (scenario errored: ${err.message})`, {}, { available: false }));
  }
}

async function main() {
  const results = [];
  let mock = null;

  if (cfg.IS_LOCAL_MOCK) {
    log(`Starting local mock on port ${cfg.MOCK_PORT} ...`);
    mock = fork(path.join(__dirname, 'mock', 'server.js'), {
      env: { ...process.env, LOAD_MOCK_PORT: String(cfg.MOCK_PORT) },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
  }

  try {
    await waitForHealth(`${cfg.TARGET_URL}/healthz`).catch(async () => {
      // Remote targets may not expose /healthz; fall back to a real API probe.
      await createAgreement();
    });
    log(`Target ready: ${cfg.TARGET_URL} (${cfg.IS_LOCAL_MOCK ? 'local mock' : 'remote'})`);

    const baseId = await createAgreement({ title: 'baseline-anchor' });
    // Dedicated target for the write-heavy update scenario, so the read/activity
    // scenarios keep reading a representative (small) agreement.
    const updateId = await createAgreement({ title: 'update-target' });
    log(`Base agreement: ${baseId} · update target: ${updateId}`);

    await runScenario(results, mock, 'create', 'Concurrent Agreement creation (POST /agreements) — also activity-write throughput.', () => scenarios.create());
    await runScenario(results, mock, 'read', 'Single Agreement read (GET /agreements/:id).', () => scenarios.read(baseId));
    await runScenario(results, mock, 'update', 'Concurrent Agreement status updates (PATCH /agreements/:id/status).', () => scenarios.update(updateId));
    await runScenario(results, mock, 'activity', 'Activity feed read (GET /agreements/:id/activity).', () => scenarios.activity(baseId));
    await runScenario(results, mock, 'burst', 'Burst traffic: 3x connections, pipelined, short window (read spike).', () => scenarios.burst(baseId));

    // Dataset-size scenarios. For the local mock we reset to an EXACT dataset via
    // IPC so the "500 / 1000" labels are accurate (the create scenario above left
    // ~20k rows behind). Remote targets can't be reset from here, so their list
    // numbers reflect whatever data already exists — noted in the report.
    const resetTo = async (count) => {
      if (!mock) {
        await seedAgreements(count); // remote: additive
        return;
      }
      await ipcRequest(mock, { cmd: 'reset' }, 'reset');
      await seedViaIpc(mock, count);
    };

    log(`Resetting + seeding ${cfg.DATASET_SMALL} agreements ...`);
    await resetTo(cfg.DATASET_SMALL);
    await runScenario(results, mock, `list_${cfg.DATASET_SMALL}`, `List by wallet against a ${cfg.DATASET_SMALL}-agreement dataset.`, () => scenarios.list(`list_${cfg.DATASET_SMALL}`));

    log(`Resetting + seeding ${cfg.DATASET_LARGE} agreements ...`);
    await resetTo(cfg.DATASET_LARGE);
    await runScenario(results, mock, `list_${cfg.DATASET_LARGE}`, `List by wallet against a ${cfg.DATASET_LARGE}-agreement dataset.`, () => scenarios.list(`list_${cfg.DATASET_LARGE}`));

    const meta = {
      generatedAt: new Date().toISOString(),
      target: cfg.TARGET_URL,
      isLocalMock: cfg.IS_LOCAL_MOCK,
      autocannonVersion: autocannonPkg.version,
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      connections: cfg.CONNECTIONS,
      duration: cfg.DURATION,
    };

    const outDir = path.join(__dirname, 'reports');
    const { jsonPath, mdPath, latestMd } = writeReport(outDir, meta, results);
    log('Report written:');
    log(`  ${path.relative(process.cwd(), latestMd)}`);
    log(`  ${path.relative(process.cwd(), mdPath)}`);
    log(`  ${path.relative(process.cwd(), jsonPath)}`);
  } finally {
    if (mock) mock.kill('SIGTERM');
  }
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[load] ${msg}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[load] FAILED:', err);
  process.exit(1);
});
