#!/usr/bin/env node
/**
 * Self-contained smoke test for scripts/008_add_accesly_identity.sql.
 *
 * Run it right after applying 008 to confirm the Accesly identity can be
 * persisted on that database. It seeds a throwaway auth_users row, inserts an
 * accesly wallet row (exercising the wallet_type CHECK, the user_id FK and the
 * new identity columns), prints the resulting user_wallets row as evidence,
 * and deletes everything it created.
 *
 * Usage:
 *   node scripts/008_verify.mjs
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment,
 * falling back to .env.local / .env in the current directory.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function loadEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnvFile('.env'), ...loadEnvFile('.env.local'), ...process.env };
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (env or .env.local).');
  process.exit(1);
}

const DB = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

// Throwaway identity, clearly marked as a smoke test.
const userId = randomUUID();
const email = `smoke-008-${userId.slice(0, 8)}@verify.thalos`;
const G = 'GCIQLYVY7QA7NASMJDNH27UQANK6Q5E2IT6QZLXCKDIYGC3YAB7P5SC4';
const C = 'CCV4UYUFZBD5CZDXZTZU47VFLWPKWRJLEWDICJAUNRZLETX63GJ4UAHW';

let failed = false;
const step = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed = true;
};

console.log(`008 smoke test against ${SUPABASE_URL}\n`);

// 1. seed a test user (what the login flow creates in public.auth_users)
const seed = await fetch(`${DB}/auth_users`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ id: userId, email, wallet_public_key: G }),
});
if (!seed.ok) {
  console.error('Could not seed auth_users:', seed.status, await seed.text());
  process.exit(1);
}
console.log(`seeded throwaway auth_users row ${userId}\n`);

try {
  // 2. the insert the backend performs on an accesly link
  const ins = await fetch(`${DB}/user_wallets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      user_id: userId,
      wallet_address: G,
      wallet_type: 'accesly',
      auth_provider: 'accesly',
      c_address: C,
      is_verified: true,
      label: '008 smoke test',
    }),
  });
  const insBody = await ins.text();
  step('user_wallets accepts an accesly identity row', ins.ok, ins.ok ? '' : `HTTP ${ins.status} ${insBody.slice(0, 200)}`);

  if (ins.ok) {
    // 3. read it back and show it — this is the evidence row
    const row = await (
      await fetch(
        `${DB}/user_wallets?select=wallet_address,wallet_type,auth_provider,c_address,is_verified&user_id=eq.${userId}`,
        { headers },
      )
    ).json();
    step('row persists auth_provider + c_address', row[0]?.auth_provider === 'accesly' && row[0]?.c_address === C);
    console.log('\nevidence row:', JSON.stringify(row[0], null, 2), '\n');
  }

  // 4. auth_users.wallet_provider is writable (frontend /api/auth/me echo)
  const upd = await fetch(`${DB}/auth_users?id=eq.${userId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ wallet_provider: 'accesly' }),
  });
  const updBody = await upd.json().catch(() => []);
  step('auth_users.wallet_provider is writable', upd.ok && updBody[0]?.wallet_provider === 'accesly');
} finally {
  // 5. leave no trace
  await fetch(`${DB}/user_wallets?user_id=eq.${userId}`, { method: 'DELETE', headers });
  await fetch(`${DB}/auth_users?id=eq.${userId}`, { method: 'DELETE', headers });
  const leftovers = await (
    await fetch(`${DB}/auth_users?select=id&id=eq.${userId}`, { headers })
  ).json();
  console.log(`cleanup done (${leftovers.length === 0 ? 'no leftovers' : 'LEFTOVERS REMAIN'})`);
}

console.log(failed ? '\nRESULT: FAIL — 008 is not (fully) applied on this database.' : '\nRESULT: PASS — 008 works on this database.');
process.exit(failed ? 1 : 0);
