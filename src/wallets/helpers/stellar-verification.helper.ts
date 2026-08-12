import { createHash, createHmac } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Centralised signed-message prefix – no inline magic strings anywhere else.
 * The actual signed envelope is the SEP-53 canonical "Stellar Signed Message:\n"
 * prefix + this marker + the rest of the body. See {@link buildChallengeMessage}.
 */
export const WALLET_OWNERSHIP_PREFIX = 'Thalos Wallet Ownership Proof';

/**
 * SEP-53 canonical prefix. Per
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md,
 * signing wallets (Pollar, Freighter, Kit, ...) sign SHA-256 of the bytes
 * "Stellar Signed Message:\n" + <message>. We adopt this framing so Pollar's
 * `sep53.signMessage()` (and any other SEP-53-compliant wallet) verifies
 * against our backend without modification.
 */
export const SEP53_PREFIX = 'Stellar Signed Message:\n';

/**
 * Network passphrase derived from the STELLAR_NETWORK env var.
 * Defaults to 'Test SDF Network ; September 2015' (testnet).
 */
export function networkPassphrase(network: string | undefined): string {
  if (!network || network === 'testnet') {
    return 'Test SDF Network ; September 2015';
  }
  return 'Public Global Stellar Network ; September 2015';
}

/**
 * Strip the trailing HMAC Proof line from a signed challenge string.
 *
 * The Proof line is server-only metadata; it MUST NOT be fed into the
 * signature bytes. The challenge body proper ends with a trailing newline
 * before "Proof: …", so we trim the trailing newline after removal to keep
 * the body byte-identical to what was signed. Leading whitespace before
 * "Proof:" is tolerated so messages re-formatted for logs don't fail.
 */
export function stripProofLine(signedMessage: string): string {
  return signedMessage.replace(/\n\s*Proof:\s*.+$/, '').trimEnd();
}

/**
 * Reconstruct the expected challenge message from parsed payload fields.
 *
 * The envelope returned to wallets is the SEP-53 canonical form:
 *
 *     Stellar Signed Message:
 *     Thalos Wallet Ownership Proof
 *
 *     I authorize linking this wallet to my Thalos account.
 *     Account: <userId>
 *     Wallet: <address>
 *     Nonce: <nonce>
 *     Issued At: <iso>
 *     Expires At: <iso>
 *
 * Note: the SEP-53 prefix always uses "\n" only once (after the colon). The
 * Proof: line is appended by the caller after HMAC signing — it is never
 * included in the signed payload.
 */
export function buildChallengeMessage(payload: {
  sub: string;
  addr: string;
  nonce: string;
  iat: string;
  exp: string;
}): string {
  // SEP-53 envelope: the bytes after the "Stellar Signed Message:" line are
  // the user-supplied body, joined with single '\n' separators. The '\n'
  // after the colon in SEP53_PREFIX is the *boundary* between the prefix and
  // the body — we therefore do not append it again to the first body line.
  return [
    `Stellar Signed Message:`,
    `${WALLET_OWNERSHIP_PREFIX}`,
    ``,
    `I authorize linking this wallet to my Thalos account.`,
    `Account: ${payload.sub}`,
    `Wallet: ${payload.addr}`,
    `Nonce: ${payload.nonce}`,
    `Issued At: ${payload.iat}`,
    `Expires At: ${payload.exp}`,
    ``,
  ].join('\n');
}

/**
 * Parse and verify a signed_message produced by `generateVerificationChallenge`.
 *
 * Returns the decoded proof payload on success.
 * Throws BadRequestException / ForbiddenException on any failure.
 *
 * The HMAC Proof line authenticates the challenge (subject, wallet, nonce,
 * expiry) and is checked BEFORE the Ed25519 signature so a rejected/forged
 * Proof short-circuits and never reaches the public-key verifier.
 */
export function parseAndVerifyChallenge(
  signedMessage: string,
  jwtSecret: string,
): {
  sub: string;
  addr: string;
  nonce: string;
  exp: number;
} {
  if (!signedMessage) {
    throw new BadRequestException('signed_message is required');
  }

  // Extract Proof line: "Proof: <payloadB64>.<hmac>"
  // Allow leading whitespace so Proof lines introduced via concat (e.g. from
  // log reformatting) don't accidentally fail validation.
  const proofMatch = signedMessage.match(/^\s*Proof:\s*(.+)$/m);
  if (!proofMatch) {
    throw new ForbiddenException('Invalid challenge format – missing Proof');
  }

  const proof = proofMatch[1];
  const [payloadB64, hmac] = proof.split('.');
  if (!payloadB64 || !hmac) {
    throw new ForbiddenException('Invalid proof format');
  }

  // Verify HMAC
  const expectedHmac = createHmac('sha256', jwtSecret).update(payloadB64).digest('base64url');

  if (hmac !== expectedHmac) {
    throw new ForbiddenException('Invalid proof signature');
  }

  // Decode payload
  let payload: { sub: string; addr: string; nonce: string; exp: number; v: number };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  } catch {
    throw new ForbiddenException('Malformed proof payload');
  }

  if (!payload.sub || !payload.addr || !payload.exp) {
    throw new ForbiddenException('Incomplete proof payload');
  }

  // Check expiry
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp < nowSec) {
    throw new ForbiddenException('Challenge has expired');
  }

  return payload;
}

/**
 * Verify the Stellar Ed25519 signature over the challenge body.
 *
 * Two formats are supported:
 *
 * 1. SEP-53 (canonical, post-fix): the body begins with "Stellar Signed
 *    Message:\n". The wallet signs SHA-256(envelopeBytes). We compute the
 *    same SHA-256 and verify the Ed25519 signature over those 32 bytes.
 *
 * 2. Legacy (pre-fix): the body begins with the Thalos prefix. The wallet
 *    signed the raw UTF-8 bytes of the body. Kept so already-linked wallets
 *    and Freighter/Kit-signed proofs created before this issue continue to
 *    verify without forcing a re-link.
 *
 * The HMAC `Proof: ...` line is stripped before dispatch in both cases so
 * server-only metadata never enters the signature bytes.
 *
 * @param signedMessage  - The full challenge text including the Proof line.
 * @param signature      - Base64url-encoded Ed25519 signature.
 * @param walletAddress  - Stellar public key that should have signed.
 * @param _passphrase    - Network passphrase (unused; signature verification is network-agnostic).
 */
export function verifyStellarSignature(
  signedMessage: string,
  signature: string,
  walletAddress: string,
  _passphrase: string,
): void {
  if (!signature) {
    throw new BadRequestException('signature is required');
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromPublicKey(walletAddress);
  } catch {
    throw new BadRequestException('Invalid Stellar public key');
  }

  const messageBody = stripProofLine(signedMessage);
  const signatureBytes = Buffer.from(signature, 'base64url');

  // Dispatch on prefix so already-linked wallets (legacy) and SEP-53 wallets
  // (canonical) both verify. The HMAC Proof line was stripped above so the
  // bytes fed to ed25519 here are exactly the bytes that were signed.
  const verifies = ((): boolean => {
    if (messageBody.startsWith(SEP53_PREFIX)) {
      // SEP-53: wallet signed SHA-256(envelopeBytes). Mirror that exactly.
      const messageHashBytes = createHash('sha256').update(messageBody, 'utf-8').digest();
      return keypair.verify(messageHashBytes, signatureBytes);
    }
    if (messageBody.startsWith(WALLET_OWNERSHIP_PREFIX)) {
      // Legacy: wallet signed the raw UTF-8 bytes of the body. Backward
      // compat for proofs issued/linked before the SEP-53 migration.
      const messageBytes = Buffer.from(messageBody, 'utf-8');
      return keypair.verify(messageBytes, signatureBytes);
    }
    throw new ForbiddenException('Unrecognized challenge prefix');
  })();

  if (!verifies) {
    throw new ForbiddenException('Invalid Stellar signature');
  }
}
