'use strict';

/**
 * Load scenarios required by issue #70, each returning an autocannon result.
 *
 * Measured areas:
 *   - create  : concurrent Agreement creation (also = activity-write throughput)
 *   - read    : GET /agreements/:id
 *   - update  : concurrent Agreement status updates (PATCH :id/status)
 *   - activity: GET /agreements/:id/activity (activity feed read)
 *   - burst   : sudden spike (3x connections, pipelined, short window)
 *   - list_N  : GET /agreements/by-wallet against an N-sized dataset
 */

const autocannon = require('autocannon');
const {
  TARGET_URL,
  API_PREFIX,
  CONNECTIONS,
  DURATION,
  authHeaders,
  sampleAgreementBody,
  TEST_WALLET,
} = require('./config');

const path = (p) => `/${API_PREFIX}/${p.replace(/^\/+/, '')}`;

function run(opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      { url: TARGET_URL, headers: authHeaders(), timeout: 30, ...opts },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    autocannon.track(instance, { renderProgressBar: false, renderResultsTable: false });
  });
}

function create({ connections = CONNECTIONS, duration = DURATION } = {}) {
  return run({
    title: 'create',
    connections,
    duration,
    requests: [
      {
        method: 'POST',
        path: path('agreements'),
        body: JSON.stringify(sampleAgreementBody()),
      },
    ],
  });
}

function read(agreementId, { connections = CONNECTIONS, duration = DURATION } = {}) {
  return run({
    title: 'read',
    connections,
    duration,
    requests: [{ method: 'GET', path: path(`agreements/${agreementId}`) }],
  });
}

function update(agreementId, { connections = CONNECTIONS, duration = DURATION } = {}) {
  return run({
    title: 'update',
    connections,
    duration,
    requests: [
      {
        method: 'PATCH',
        path: path(`agreements/${agreementId}/status`),
        body: JSON.stringify({ status: 'funded', actor_wallet: TEST_WALLET }),
      },
    ],
  });
}

function activity(agreementId, { connections = CONNECTIONS, duration = DURATION } = {}) {
  return run({
    title: 'activity',
    connections,
    duration,
    requests: [{ method: 'GET', path: path(`agreements/${agreementId}/activity`) }],
  });
}

function burst(agreementId, { connections = CONNECTIONS * 3, duration = 5 } = {}) {
  return run({
    title: 'burst',
    connections,
    duration,
    pipelining: 10,
    // Spike test against a light read endpoint (spike handling, not payload size).
    requests: [{ method: 'GET', path: path(`agreements/${agreementId}`) }],
  });
}

function list(label, { connections = CONNECTIONS, duration = DURATION } = {}) {
  return run({
    title: label,
    connections,
    duration,
    requests: [{ method: 'GET', path: path(`agreements/by-wallet?wallet=${TEST_WALLET}`) }],
  });
}

module.exports = { create, read, update, activity, burst, list };
