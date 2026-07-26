import { createHmac } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Centralised signed-message prefix – no inline magic strings anywhere else.
 */
export const WALLET_OWNERSHIP_PREFIX = 'Thalos Wallet Ownership Proof';

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
 * Reconstruct the expected challenge message from parsed payload fields.
 * This is the exact text the wallet must have signed.
 */
export function buildChallengeMessage(payload: {
  sub: string;
  addr: string;
  nonce: string;
  iat: string;
  exp: string;
}): string {
  return [
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
  const proofMatch = signedMessage.match(/^Proof:\s*(.+)$/m);
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
 * Verify the Stellar Ed25519 signature over the full signed_message text.
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

  // The signed payload is the full message text WITHOUT the "Proof: ..." line.
  const messageBody = signedMessage.replace(/\nProof:\s*.+$/, '').trimEnd();

  const messageBytes = Buffer.from(messageBody, 'utf-8');
  const signatureBytes = Buffer.from(signature, 'base64url');

  const valid = keypair.verify(messageBytes, signatureBytes);
  if (!valid) {
    throw new ForbiddenException('Invalid Stellar signature');
  }
}
