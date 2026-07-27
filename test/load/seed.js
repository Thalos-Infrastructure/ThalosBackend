'use strict';

/**
 * Standalone dataset seeder.
 *
 *   node test/load/seed.js 500
 *   LOAD_DATASET_LARGE=1000 node test/load/seed.js
 *
 * Against the local mock this just fills its in-memory store; against staging it
 * creates real Agreements for the seeded test user/wallet. NEVER run against prod.
 */

const cfg = require('./config');
const { waitForHealth, seedAgreements } = require('./lib/http');

async function main() {
  const count = Number(process.argv[2]) || cfg.DATASET_LARGE;
  await waitForHealth(`${cfg.TARGET_URL}/healthz`).catch(() => {});
  // eslint-disable-next-line no-console
  console.log(`[seed] creating ${count} agreements at ${cfg.TARGET_URL} ...`);
  await seedAgreements(count);
  // eslint-disable-next-line no-console
  console.log(`[seed] done (${count}).`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
