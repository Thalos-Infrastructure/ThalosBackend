import { Keypair } from '@stellar/stellar-sdk';
import { createHash, createHmac } from 'crypto';
import {
  SEP53_PREFIX,
  WALLET_OWNERSHIP_PREFIX,
  buildChallengeMessage,
  networkPassphrase,
  parseAndVerifyChallenge,
  stripProofLine,
  verifyStellarSignature,
} from './stellar-verification.helper';

// --- Test helpers -------------------------------------------------------

const JWT_SECRET = 'unit-test-jwt-secret';

function buildSignedPayload(opts: {
  sub?: string;
  addr?: string;
  exp?: number;
  v?: number;
  /** Override nonce if you want determinism. */
  nonce?: string;
}) {
  const sub = opts.sub ?? 'user-abc';
  const addr = opts.addr ?? Keypair.random().publicKey();
  const nonce = opts.nonce ?? 'fixed-nonce-1234';
  const exp = opts.exp ?? Math.floor(Date.now() / 1000) + 300;
  const payload = { v: opts.v ?? 1, sub, addr, nonce, exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
  return { payload, payloadB64, proof: `${payloadB64}.${sig}` };
}

function makeSignedMessage({ envelope, proof }: { envelope: string; proof?: string }): string {
  // Layout mirrors the real `generateVerificationChallenge` output:
  //   <envelope body ending in blank line> + "\nProof: <proof>"
  return proof ? `${envelope}\nProof: ${proof}` : envelope;
}

function signEnvelopeSeal53(envelope: string, secretSeed: string): string {
  const keypair = Keypair.fromSecret(secretSeed);
  const hash = createHash('sha256').update(envelope, 'utf-8').digest();
  return keypair.sign(hash).toString('base64url');
}

function signEnvelopeRawUtf8(envelope: string, secretSeed: string): string {
  const keypair = Keypair.fromSecret(secretSeed);
  return keypair.sign(Buffer.from(envelope, 'utf-8')).toString('base64url');
}

// --- buildChallengeMessage ---------------------------------------------

describe('buildChallengeMessage', () => {
  it('produces an envelope that begins with the SEP-53 canonical prefix', () => {
    const msg = buildChallengeMessage({
      sub: 'user-1',
      addr: 'GABC',
      nonce: 'n',
      iat: '2026-01-01T00:00:00.000Z',
      exp: '2026-01-01T00:05:00.000Z',
    });
    expect(msg.startsWith(SEP53_PREFIX)).toBe(true);
  });

  it('keeps the Thalos marker line right after the SEP-53 prefix', () => {
    const msg = buildChallengeMessage({
      sub: 'user-1',
      addr: 'GABC',
      nonce: 'n',
      iat: '2026-01-01T00:00:00.000Z',
      exp: '2026-01-01T00:05:00.000Z',
    });
    const lines = msg.split('\n');
    expect(lines[0]).toBe('Stellar Signed Message:');
    expect(lines[1]).toBe(WALLET_OWNERSHIP_PREFIX);
  });

  it('includes subject, wallet address, nonce and ISO timestamps', () => {
    const msg = buildChallengeMessage({
      sub: 'user-42',
      addr: 'GXYZ',
      nonce: 'deadbeef',
      iat: '2026-01-01T00:00:00.000Z',
      exp: '2026-01-01T00:05:00.000Z',
    });
    expect(msg).toContain('Account: user-42');
    expect(msg).toContain('Wallet: GXYZ');
    expect(msg).toContain('Nonce: deadbeef');
    expect(msg).toContain('Issued At: 2026-01-01T00:00:00.000Z');
    expect(msg).toContain('Expires At: 2026-01-01T00:05:00.000Z');
  });
});

// --- stripProofLine ----------------------------------------------------

describe('stripProofLine', () => {
  it('removes the trailing Proof: line so it never enters signature bytes', () => {
    const body = `${SEP53_PREFIX}hello`;
    const signedMessage = `${body}\n Proof: payloadB64.hmac`;
    expect(stripProofLine(signedMessage)).toBe(body);
  });

  it('returns the message unchanged when there is no Proof line', () => {
    const body = `${SEP53_PREFIX}only-body`;
    expect(stripProofLine(body)).toBe(body);
  });
});

// --- parseAndVerifyChallenge ------------------------------------------

describe('parseAndVerifyChallenge', () => {
  it('rejects when signed_message is empty', () => {
    expect(() => parseAndVerifyChallenge('', JWT_SECRET)).toThrow(/signed_message is required/);
  });

  it('rejects when the Proof line is missing', () => {
    expect(() => parseAndVerifyChallenge('no proof here', JWT_SECRET)).toThrow(/missing Proof/);
  });

  it('rejects when the HMAC does not match', () => {
    const { payloadB64 } = buildSignedPayload({});
    const tampered = `${SEP53_PREFIX}msg\n Proof: ${payloadB64}.not-the-right-hmac`;
    expect(() => parseAndVerifyChallenge(tampered, JWT_SECRET)).toThrow(/Invalid proof signature/);
  });

  it('rejects when the proof is malformed (missing hmac)', () => {
    const signedMessage = `${SEP53_PREFIX}msg\n Proof: onlyPayloadB64`;
    expect(() => parseAndVerifyChallenge(signedMessage, JWT_SECRET)).toThrow(
      /Invalid proof format/,
    );
  });

  it('rejects when the payload is not valid JSON', () => {
    const badPayloadB64 = Buffer.from('not json {{{').toString('base64url');
    const sig = createHmac('sha256', JWT_SECRET).update(badPayloadB64).digest('base64url');
    const signedMessage = `${SEP53_PREFIX}msg\n Proof: ${badPayloadB64}.${sig}`;
    expect(() => parseAndVerifyChallenge(signedMessage, JWT_SECRET)).toThrow(
      /Malformed proof payload/,
    );
  });

  it('rejects when an essential payload field is missing', () => {
    const payload = { v: 1, sub: '', addr: 'GABC', nonce: 'n', exp: 9999999999 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
    const signedMessage = `${SEP53_PREFIX}msg\n Proof: ${payloadB64}.${sig}`;
    expect(() => parseAndVerifyChallenge(signedMessage, JWT_SECRET)).toThrow(
      /Incomplete proof payload/,
    );
  });

  it('rejects when the challenge has expired', () => {
    const { proof } = buildSignedPayload({ exp: Math.floor(Date.now() / 1000) - 10 });
    const signedMessage = `${SEP53_PREFIX}body\n Proof: ${proof}`;
    expect(() => parseAndVerifyChallenge(signedMessage, JWT_SECRET)).toThrow(/expired/);
  });

  it('returns the decoded payload on success', () => {
    const { payload, proof } = buildSignedPayload({});
    const signedMessage = `${SEP53_PREFIX}body\n Proof: ${proof}`;
    const decoded = parseAndVerifyChallenge(signedMessage, JWT_SECRET);
    expect(decoded.sub).toBe(payload.sub);
    expect(decoded.addr).toBe(payload.addr);
    expect(decoded.nonce).toBe(payload.nonce);
    expect(decoded.exp).toBe(payload.exp);
  });
});

// --- verifyStellarSignature: SEP-53 happy path --------------------------

describe('verifyStellarSignature – SEP-53 canonical framing', () => {
  // SEP-53 reference vector from
  // https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
  it('accepts the published SEP-53 reference test vector', () => {
    const envelope = `Stellar Signed Message:\nHello, World!`;
    const signature =
      'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==';
    const address = 'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L';
    expect(() => verifyStellarSignature(envelope, signature, address, 'unused')).not.toThrow();
  });

  it('verifies a SEP-53 framed envelope signed by a freshly-generated keypair', () => {
    const keypair = Keypair.random();
    const envelope = makeSignedMessage({
      envelope: `${SEP53_PREFIX}Thalos Wallet Ownership Proof\n\nHello from a SEP-53 wallet`,
    });
    const signature = signEnvelopeSeal53(stripProofLine(envelope), keypair.secret());
    expect(() =>
      verifyStellarSignature(envelope, signature, keypair.publicKey(), 'unused'),
    ).not.toThrow();
  });

  it('still verifies when an HMAC Proof line is appended to the SEP-53 envelope', () => {
    const keypair = Keypair.random();
    const { proof } = buildSignedPayload({ addr: keypair.publicKey() });
    const envelope = `${SEP53_PREFIX}Thalos Wallet Ownership Proof\n\nI authorize linking this wallet to my Thalos account.\n`;
    const signedMessage = makeSignedMessage({ envelope, proof });
    const signature = signEnvelopeSeal53(stripProofLine(signedMessage), keypair.secret());
    expect(() =>
      verifyStellarSignature(signedMessage, signature, keypair.publicKey(), 'unused'),
    ).not.toThrow();
  });

  it('rejects when the signature is over the raw envelope (SHA-256 step was skipped)', () => {
    const keypair = Keypair.random();
    const envelope = `${SEP53_PREFIX}Thalos Wallet Ownership Proof\n\nbody`;
    const signedMessage = makeSignedMessage({ envelope });
    // Sign RAW bytes — must NOT verify under SEP-53 framing.
    const signature = signEnvelopeRawUtf8(stripProofLine(signedMessage), keypair.secret());
    expect(() =>
      verifyStellarSignature(signedMessage, signature, keypair.publicKey(), 'unused'),
    ).toThrow(/Invalid Stellar signature/);
  });
});

// --- verifyStellarSignature: legacy backward compat ---------------------

describe('verifyStellarSignature – legacy backward compatibility', () => {
  it('still verifies proofs that start with the legacy Thalos prefix', () => {
    const keypair = Keypair.random();
    const legacyEnvelope = `${WALLET_OWNERSHIP_PREFIX}\n\nI authorize linking this wallet to my Thalos account.`;
    const signedMessage = makeSignedMessage({ envelope: legacyEnvelope });
    const signature = signEnvelopeRawUtf8(stripProofLine(signedMessage), keypair.secret());
    expect(() =>
      verifyStellarSignature(signedMessage, signature, keypair.publicKey(), 'unused'),
    ).not.toThrow();
  });

  it('does NOT verify legacy proofs against the SHA-256 path', () => {
    const keypair = Keypair.random();
    const legacyEnvelope = `${WALLET_OWNERSHIP_PREFIX}\n\nbody`;
    const signedMessage = makeSignedMessage({ envelope: legacyEnvelope });
    // Wrong path — SHA-256 hash instead of raw bytes. Must be rejected.
    const signature = signEnvelopeSeal53(stripProofLine(signedMessage), keypair.secret());
    expect(() =>
      verifyStellarSignature(signedMessage, signature, keypair.publicKey(), 'unused'),
    ).toThrow(/Invalid Stellar signature/);
  });
});

// --- verifyStellarSignature: failure modes -----------------------------

describe('verifyStellarSignature – failure modes', () => {
  it('rejects when signature is empty', () => {
    expect(() =>
      verifyStellarSignature(`${SEP53_PREFIX}msg`, '', Keypair.random().publicKey(), 'unused'),
    ).toThrow(/signature is required/);
  });

  it('rejects when the Stellar public key is invalid', () => {
    expect(() =>
      verifyStellarSignature(`${SEP53_PREFIX}msg`, 'AAAA', 'NOT-A-VALID-KEY', 'unused'),
    ).toThrow(/Invalid Stellar public key/);
  });

  it('rejects when the message has no recognized prefix', () => {
    const keypair = Keypair.random();
    const signedMessage = makeSignedMessage({ envelope: `mystery prefix\nbody` });
    const signature = signEnvelopeRawUtf8(stripProofLine(signedMessage), keypair.secret());
    expect(() =>
      verifyStellarSignature(signedMessage, signature, keypair.publicKey(), 'unused'),
    ).toThrow(/Unrecognized challenge prefix/);
  });

  it('rejects when a valid SEP-53 envelope is tampered with', () => {
    const keypair = Keypair.random();
    const envelope = `${SEP53_PREFIX}Thalos Wallet Ownership Proof\n\nHello`;
    const signedMessage = makeSignedMessage({ envelope });
    const signature = signEnvelopeSeal53(stripProofLine(signedMessage), keypair.secret());
    const tampered = `${SEP53_PREFIX}Thalos Wallet Ownership Proof\n\nHELLO`; // changed body
    expect(() =>
      verifyStellarSignature(tampered, signature, keypair.publicKey(), 'unused'),
    ).toThrow(/Invalid Stellar signature/);
  });
});

// --- networkPassphrase -------------------------------------------------

describe('networkPassphrase', () => {
  it('returns the testnet passphrase by default', () => {
    expect(networkPassphrase(undefined)).toBe('Test SDF Network ; September 2015');
    expect(networkPassphrase('testnet')).toBe('Test SDF Network ; September 2015');
  });

  it('returns the public/mainnet passphrase when asked', () => {
    expect(networkPassphrase('mainnet')).toBe('Public Global Stellar Network ; September 2015');
    expect(networkPassphrase('public')).toBe('Public Global Stellar Network ; September 2015');
  });
});
