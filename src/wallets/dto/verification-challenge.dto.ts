import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerificationChallengeQueryDto {
  @ApiProperty({
    example: 'GA7QYNF7SOWQ3GLR2BGMZEHHHVSH3VK4UFR2QPYDQGPHK3WSALDQXJZN',
    description: 'Stellar public key (G..., 56 chars)',
  })
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'address must be a valid Stellar public key (G..., 56 chars)',
  })
  address: string;
}

/**
 * Response contract for `GET /v1/wallets/verification-challenge`.
 *
 * The field names are part of the frontend contract (ThalosFrontend reads
 * `message` and `expires_at` verbatim) — renaming either breaks wallet linking,
 * so they are pinned here and asserted in
 * `wallets/verification-challenge.contract.spec.ts`.
 */
export class VerificationChallengeResponseDto {
  @ApiProperty({
    description:
      'SEP-53 canonical envelope the wallet must sign, ending with the server-only ' +
      '"Proof: <payload>.<hmac>" line. Sent back verbatim as `signed_message`.',
    example:
      'Stellar Signed Message:\nThalos Wallet Ownership Proof\n\nI authorize linking this wallet to my Thalos account.\n...',
  })
  message: string;

  @ApiProperty({
    description: 'ISO-8601 UTC instant after which the challenge is rejected (5 minute TTL).',
    example: '2026-01-01T12:05:00.000Z',
  })
  expires_at: string;
}
