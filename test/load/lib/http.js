'use strict';

/** Minimal HTTP helpers built on Node's global fetch (Node >= 20). */

const { apiUrl, authHeaders, sampleAgreementBody } = require('../config');

async function waitForHealth(healthUrl, timeoutMs = 10000) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`health check timed out: ${healthUrl}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Create one agreement and return its id (used to seed read/update scenarios). */
async function createAgreement(overrides = {}) {
  const res = await fetch(apiUrl('agreements'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(sampleAgreementBody(overrides)),
  });
  if (res.status !== 201) {
    const text = await res.text();
    throw new Error(`create failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.agreement.id;
}

/** Create `count` agreements sequentially-ish with limited concurrency. */
async function seedAgreements(count, concurrency = 20) {
  let created = 0;
  const worker = async () => {
    while (created < count) {
      const i = created++;
      if (i >= count) break;
      await createAgreement({ title: `Seed agreement ${i}` });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return count;
}

module.exports = { waitForHealth, createAgreement, seedAgreements };
