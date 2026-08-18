/**
 * GF-8-BE — wallet verification challenge payload contract.
 *
 * ThalosFrontend reads `message` (handed verbatim to the wallet for signing)
 * and `expires_at` (to grey out an expired challenge) from
 * `GET /v1/wallets/verification-challenge`. These tests pin those field names
 * and shapes, and pin the round trip: what the backend issues is exactly what
 * `parseAndVerifyChallenge` accepts back on `POST /v1/wallets/:id/verify`.
 */
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiClient } from '../common/api/api-client';
import { SupabaseService } from '../supabase/supabase.service';
import { WalletsService } from './wallets.service';
import { parseAndVerifyChallenge, stripProofLine } from './helpers/stellar-verification.helper';

const USER_ID = 'user-challenge-1';
const G_ADDRESS = 'GCIQLYVY7QA7NASMJDNH27UQANK6Q5E2IT6QZLXCKDIYGC3YAB7P5SC4';
const SHARED_SECRET = 'shared-supabase-jwt-secret-32-chars!!';

/** WalletsService with only the config it needs to mint a challenge. */
function makeService(env: Record<string, string | undefined>): WalletsService {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new WalletsService({} as SupabaseService, config, {} as ApiClient);
}

describe('GET /wallets/verification-challenge — payload contract', () => {
  const service = makeService({
    STELLAR_NETWORK: 'testnet',
    SUPABASE_JWT_SECRET: SHARED_SECRET,
  });

  it('returns exactly { message, expires_at } — the field names the FE reads', () => {
    const challenge = service.generateVerificationChallenge(USER_ID, G_ADDRESS);

    expect(Object.keys(challenge).sort()).toEqual(['expires_at', 'message']);
    expect(typeof challenge.message).toBe('string');
    expect(typeof challenge.expires_at).toBe('string');
  });

  it('expires_at is an ISO-8601 UTC instant, 5 minutes out', () => {
    const before = Date.now();
    const { expires_at } = service.generateVerificationChallenge(USER_ID, G_ADDRESS);

    expect(expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(expires_at).toISOString()).toBe(expires_at);

    const ttlMs = new Date(expires_at).getTime() - before;
    expect(ttlMs).toBeGreaterThan(4 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
  });

  it('message is the SEP-53 envelope and echoes the account, wallet and expiry', () => {
    const { message, expires_at } = service.generateVerificationChallenge(USER_ID, G_ADDRESS);

    expect(message.startsWith('Stellar Signed Message:\n')).toBe(true);
    expect(message).toContain('Thalos Wallet Ownership Proof');
    expect(message).toContain(`Account: ${USER_ID}`);
    expect(message).toContain(`Wallet: ${G_ADDRESS}`);
    expect(message).toContain(`Expires At: ${expires_at}`);
    expect(message).toMatch(/\nProof: [\w-]+\.[\w-]+$/);
  });

  it('never leaks the shared secret into the message', () => {
    const { message } = service.generateVerificationChallenge(USER_ID, G_ADDRESS);
    expect(message).not.toContain(SHARED_SECRET);
  });

  it('issues a fresh nonce per call so a challenge cannot be replayed', () => {
    const first = service.generateVerificationChallenge(USER_ID, G_ADDRESS);
    const second = service.generateVerificationChallenge(USER_ID, G_ADDRESS);

    const nonceOf = (message: string) => /Nonce: (\w+)/.exec(message)?.[1];
    expect(nonceOf(first.message)).toBeDefined();
    expect(nonceOf(first.message)).not.toBe(nonceOf(second.message));
  });

  it('the signable body excludes the server-only Proof line', () => {
    const { message } = service.generateVerificationChallenge(USER_ID, G_ADDRESS);
    expect(stripProofLine(message)).not.toContain('Proof:');
  });
});

describe('verification challenge — issue/verify round trip', () => {
  it('a challenge issued with the shared secret verifies with that same secret', () => {
    const service = makeService({ SUPABASE_JWT_SECRET: SHARED_SECRET });
    const { message } = service.generateVerificationChallenge(USER_ID, G_ADDRESS);

    const payload = parseAndVerifyChallenge(message, SHARED_SECRET);

    expect(payload.sub).toBe(USER_ID);
    expect(payload.addr).toBe(G_ADDRESS);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('resolves the same secret from the legacy JWT_SECRET name', () => {
    const service = makeService({ JWT_SECRET: SHARED_SECRET });
    const { message } = service.generateVerificationChallenge(USER_ID, G_ADDRESS);

    expect(parseAndVerifyChallenge(message, SHARED_SECRET).sub).toBe(USER_ID);
  });

  it('prefers SUPABASE_JWT_SECRET when both names are set', () => {
    const service = makeService({
      SUPABASE_JWT_SECRET: SHARED_SECRET,
      JWT_SECRET: 'legacy-secret-that-must-not-be-used!!',
    });
    const { message } = service.generateVerificationChallenge(USER_ID, G_ADDRESS);

    expect(parseAndVerifyChallenge(message, SHARED_SECRET).sub).toBe(USER_ID);
  });

  it('rejects a challenge whose Proof was HMACed with a different secret', () => {
    const service = makeService({ SUPABASE_JWT_SECRET: 'attacker-minted-challenge-secret!!!!!' });
    const { message } = service.generateVerificationChallenge(USER_ID, G_ADDRESS);

    expect(() => parseAndVerifyChallenge(message, SHARED_SECRET)).toThrow(ForbiddenException);
  });

  it('fails with a generic 500 (never the secret) when no secret is configured', () => {
    const service = makeService({ STELLAR_NETWORK: 'testnet' });

    expect(() => service.generateVerificationChallenge(USER_ID, G_ADDRESS)).toThrow(
      'Server misconfiguration',
    );
  });
});
