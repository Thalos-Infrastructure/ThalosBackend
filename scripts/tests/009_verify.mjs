#!/usr/bin/env node
/**
 * Self-contained smoke test for scripts/009_profiles_connect_fields.sql.
 *
 * Run it right after applying 009 to confirm the Thalos Connect Builder/Project
 * fields work on that database. It:
 *   1. inserts a throwaway profile with Builder + Project data (arrays, jsonb,
 *      availability, a URL-safe handle),
 *   2. reads it back and asserts every new field round-trips,
 *   3. asserts the handle UNIQUE index rejects a duplicate handle,
 *   4. asserts the URL-safe CHECK rejects a malformed handle,
 *   5. exercises the discovery filter (handle set + skills array overlap),
 *   6. prints the evidence row, then deletes everything it created.
 *
 * Usage:
 *   node tests/009_verify.mjs
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment,
 * falling back to .env / .env.local in the current directory (repo root).
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
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (env or .env / .env.local).');
  process.exit(1);
}

const DB = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

// Throwaway identities, clearly marked as a smoke test.
const tag = randomUUID().slice(0, 8);
const wallet1 = `SMOKE009A${tag}`;
const wallet2 = `SMOKE009B${tag}`;
const wallet3 = `SMOKE009C${tag}`;
const handle = `smoke-009-${tag}`;
const allWallets = [wallet1, wallet2, wallet3];

let failed = false;
const step = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed = true;
};

const del = (wallet) =>
  fetch(`${DB}/profiles?wallet_address=eq.${wallet}`, { method: 'DELETE', headers });

console.log(`009 smoke test against ${SUPABASE_URL}\n`);

// Clean any leftovers from a previous aborted run.
await Promise.all(allWallets.map(del));

try {
  // 1. insert a profile carrying Builder + Project data (additive types)
  const builderProject = {
    wallet_address: wallet1,
    display_name: '009 smoke',
    account_type: 'personal',
    // Builder
    headline: 'Full-stack builder',
    bio: 'CR builder for the 009 smoke test',
    skills: ['react', 'node'],
    tech_stack: ['stellar', 'nestjs'],
    hourly_rate: 45,
    availability: 'available',
    portfolio_links: [{ label: 'site', url: 'https://example.com' }],
    social_links: { github: 'https://github.com/example' },
    handle,
    // Project
    org_name: 'Acme Labs',
    org_description: 'Builds things',
    org_website: 'https://acme.example',
    looking_for: ['frontend', 'design'],
    org_links: { discord: 'https://discord.gg/example' },
  };

  const ins = await fetch(`${DB}/profiles`, {
    method: 'POST',
    headers,
    body: JSON.stringify(builderProject),
  });
  const insBody = await ins.text();
  step(
    'profiles accepts Builder + Project fields',
    ins.ok,
    ins.ok ? '' : `HTTP ${ins.status} ${insBody.slice(0, 200)}`,
  );

  if (ins.ok) {
    // 2. read it back — this is the evidence row
    const rows = await (
      await fetch(
        `${DB}/profiles?select=wallet_address,headline,skills,tech_stack,hourly_rate,availability,portfolio_links,social_links,handle,org_name,looking_for,org_links&wallet_address=eq.${wallet1}`,
        { headers },
      )
    ).json();
    const row = rows[0] ?? {};
    step(
      'Builder fields round-trip (skills/tech_stack/hourly_rate/availability/handle)',
      Array.isArray(row.skills) &&
        row.skills.includes('react') &&
        Array.isArray(row.tech_stack) &&
        row.tech_stack.includes('stellar') &&
        Number(row.hourly_rate) === 45 &&
        row.availability === 'available' &&
        row.handle === handle,
    );
    step(
      'Project fields round-trip (org_name/looking_for/org_links)',
      row.org_name === 'Acme Labs' &&
        Array.isArray(row.looking_for) &&
        row.looking_for.includes('frontend') &&
        row.org_links?.discord === 'https://discord.gg/example',
    );
    console.log('\nevidence row:', JSON.stringify(row, null, 2), '\n');
  }

  // 3. handle UNIQUE index: a second profile with the same handle must fail
  const dupe = await fetch(`${DB}/profiles`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ wallet_address: wallet2, handle }),
  });
  step(
    'duplicate handle is rejected (unique index)',
    !dupe.ok,
    dupe.ok ? 'unexpectedly accepted a duplicate handle' : `HTTP ${dupe.status}`,
  );

  // 4. URL-safe CHECK: a malformed handle must fail
  const bad = await fetch(`${DB}/profiles`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ wallet_address: wallet3, handle: 'Not Valid!' }),
  });
  step(
    'malformed handle is rejected (URL-safe check)',
    !bad.ok,
    bad.ok ? 'unexpectedly accepted a malformed handle' : `HTTP ${bad.status}`,
  );

  // 5. discovery filter: handle set + skills array overlap returns the profile
  const discovery = await (
    await fetch(
      `${DB}/profiles?select=wallet_address,handle,skills&handle=not.is.null&skills=ov.{react}&wallet_address=eq.${wallet1}`,
      { headers },
    )
  ).json();
  step(
    'discovery filter matches (handle set + skills overlap)',
    Array.isArray(discovery) &&
      discovery.length === 1 &&
      discovery[0].wallet_address === wallet1,
  );
} finally {
  // 6. leave no trace
  await Promise.all(allWallets.map(del));
  const leftovers = await (
    await fetch(
      `${DB}/profiles?select=wallet_address&wallet_address=in.(${allWallets.join(',')})`,
      { headers },
    )
  ).json();
  console.log(
    `\ncleanup done (${Array.isArray(leftovers) && leftovers.length === 0 ? 'no leftovers' : 'LEFTOVERS REMAIN'})`,
  );
}

console.log(
  failed
    ? '\nRESULT: FAIL — 009 is not (fully) applied on this database.'
    : '\nRESULT: PASS — 009 works on this database.',
);
process.exit(failed ? 1 : 0);
