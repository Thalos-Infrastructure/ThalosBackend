'use strict';

/**
 * In-memory mock of the Thalos Agreement API, used as the DEFAULT local target
 * so the load suite is fully runnable without Supabase/Stellar/Trustless Work.
 *
 * It mirrors the real contract closely enough to produce a meaningful,
 * reproducible baseline for the *application-shaped* request path:
 *   - JWT bearer auth (HS256, same JWT_SECRET), rejecting bad tokens.
 *   - POST   /v1/agreements                 -> create + activity log
 *   - GET    /v1/agreements/:id             -> read one
 *   - PATCH  /v1/agreements/:id/status      -> update status + activity log
 *   - GET    /v1/agreements/:id/activity    -> activity feed
 *   - GET    /v1/agreements/by-wallet?wallet -> list (dataset-size sensitive)
 *   - GET    /healthz                        -> liveness (no auth)
 *
 * A configurable SIM_DB_LATENCY_MS models Supabase round-trip latency so the
 * numbers aren't purely CPU-bound. Outbound Trustless Work calls are NOT made
 * (the real create/update path doesn't call TW synchronously either), so the
 * baseline reflects Thalos, not TW rate limits.
 *
 * This is intentionally NOT the production server. On staging you bypass this
 * entirely by setting THALOS_TARGET_URL.
 */

const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  JWT_SECRET,
  API_PREFIX,
  TEST_USER_ID,
  TEST_WALLET,
  SIM_DB_LATENCY_MS,
} = require('../config');

/** In-memory "tables". */
const db = {
  authUsers: new Map([[TEST_USER_ID, { wallet_public_key: TEST_WALLET }]]),
  agreements: new Map(),
  activity: new Map(), // agreementId -> [rows]
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
/** Simulate a DB round-trip with light jitter. */
const dbTick = () => delay(SIM_DB_LATENCY_MS + Math.random() * SIM_DB_LATENCY_MS);

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function authUser(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const payload = jwt.verify(m[1], JWT_SECRET, { algorithms: ['HS256'] });
    if (!payload?.sub) return null;
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

/** Keep a bounded history per agreement so load runs stay O(1) and memory-safe. */
const ACTIVITY_CAP = 1000;

function logActivity(agreementId, actorWallet, action, details) {
  let list = db.activity.get(agreementId);
  if (!list) {
    list = [];
    db.activity.set(agreementId, list);
  }
  list.push({
    id: crypto.randomUUID(),
    agreement_id: agreementId,
    actor_wallet: actorWallet,
    action,
    details: details || {},
    created_at: new Date().toISOString(),
  });
  // Bound memory/latency: drop oldest beyond the cap.
  if (list.length > ACTIVITY_CAP) list.splice(0, list.length - ACTIVITY_CAP);
}

async function handle(req, res, url) {
  // Liveness — no auth, no DB.
  if (req.method === 'GET' && url.pathname === '/healthz') {
    return send(res, 200, { status: 'ok', agreements: db.agreements.size });
  }

  const base = `/${API_PREFIX}/agreements`;
  const p = url.pathname;

  if (!p.startsWith(base)) return send(res, 404, { error: 'not found' });

  const user = authUser(req);
  if (!user) return send(res, 401, { error: 'Unauthorized' });
  const wallet = db.authUsers.get(user.userId)?.wallet_public_key;
  if (!wallet) return send(res, 403, { error: 'No wallet for user' });

  // POST /agreements
  if (req.method === 'POST' && p === base) {
    const dto = await readBody(req);
    if (!dto.title || !dto.amount || !Array.isArray(dto.participants)) {
      return send(res, 400, { error: 'invalid body' });
    }
    if (dto.created_by !== wallet) {
      return send(res, 403, { error: 'created_by must equal user wallet' });
    }
    await dbTick(); // insert agreement
    const id = crypto.randomUUID();
    const agreement = {
      id,
      title: dto.title,
      description: dto.description ?? null,
      amount: dto.amount,
      asset: dto.asset ?? 'USDC',
      status: 'pending',
      agreement_type: dto.agreement_type ?? 'single',
      milestones: dto.milestones ?? [],
      metadata: dto.metadata ?? {},
      created_by: dto.created_by,
      created_at: new Date().toISOString(),
    };
    db.agreements.set(id, agreement);
    await dbTick(); // insert participants
    logActivity(id, dto.created_by, 'created', { title: dto.title, amount: dto.amount });
    return send(res, 201, { agreement, error: null });
  }

  // GET /agreements/by-wallet?wallet=...
  if (req.method === 'GET' && p === `${base}/by-wallet`) {
    if (url.searchParams.get('wallet') !== wallet) {
      return send(res, 403, { error: 'wallet mismatch' });
    }
    await dbTick();
    const rows = [];
    for (const a of db.agreements.values()) {
      if (a.created_by === wallet) rows.push(a);
    }
    return send(res, 200, { agreements: rows, error: null });
  }

  // Sub-resources: /agreements/:id and /agreements/:id/{activity,status}
  const rest = p.slice(base.length + 1); // after "/agreements/"
  const [id, sub] = rest.split('/');

  if (!id) return send(res, 404, { error: 'not found' });

  // GET /agreements/:id/activity
  if (req.method === 'GET' && sub === 'activity') {
    await dbTick();
    if (!db.agreements.has(id)) return send(res, 404, { error: 'Agreement not found' });
    // Newest-first, matching the real API's order('created_at', desc).
    const rows = (db.activity.get(id) || []).slice().reverse();
    return send(res, 200, { activities: rows, error: null });
  }

  // PATCH /agreements/:id/status
  if (req.method === 'PATCH' && sub === 'status') {
    const dto = await readBody(req);
    await dbTick();
    const agreement = db.agreements.get(id);
    if (!agreement) return send(res, 404, { error: 'Agreement not found' });
    if (dto.actor_wallet !== wallet) return send(res, 403, { error: 'actor_wallet mismatch' });
    agreement.status = dto.status ?? agreement.status;
    agreement.updated_at = new Date().toISOString();
    await dbTick();
    logActivity(id, wallet, `status_changed_to_${agreement.status}`, { status: agreement.status });
    return send(res, 200, { success: true, error: null });
  }

  // GET /agreements/:id
  if (req.method === 'GET' && !sub) {
    await dbTick();
    const agreement = db.agreements.get(id);
    if (!agreement) return send(res, 404, { error: 'Agreement not found' });
    return send(res, 200, { agreement, participants: [], error: null });
  }

  return send(res, 404, { error: 'not found' });
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    handle(req, res, url).catch((err) => {
      send(res, 500, { error: String(err?.message || err) });
    });
  });
}

/** Pre-populate the store to simulate a given dataset size. */
function seedAgreements(count) {
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    db.agreements.set(id, {
      id,
      title: `Seed agreement ${i}`,
      amount: '100.00',
      asset: 'USDC',
      status: 'pending',
      created_by: TEST_WALLET,
      created_at: new Date().toISOString(),
    });
    logActivity(id, TEST_WALLET, 'created', { seeded: true });
  }
  return db.agreements.size;
}

module.exports = { createServer, seedAgreements, db };

// Allow running standalone: `node test/load/mock/server.js`
if (require.main === module) {
  const port = Number(process.env.LOAD_MOCK_PORT) || 4599;
  const server = createServer();
  // Tolerate abrupt client disconnects (autocannon churns connections hard)
  // instead of surfacing them as process-level errors.
  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  server.keepAliveTimeout = 60000;
  server.headersTimeout = 65000;
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[mock] Thalos Agreement API mock listening on http://127.0.0.1:${port}`);
  });

  // In-process seeding via IPC (used by run-all for the local mock) so we don't
  // hammer the HTTP layer just to populate data.
  if (process.send) {
    process.on('message', (msg) => {
      if (!msg) return;
      if (msg.cmd === 'reset') {
        // Clear data but keep the auth_users mapping.
        db.agreements.clear();
        db.activity.clear();
        process.send({ ok: true, size: 0 });
      } else if (msg.cmd === 'seed') {
        const size = seedAgreements(Number(msg.count) || 0);
        process.send({ ok: true, size });
      }
    });
  }
}
