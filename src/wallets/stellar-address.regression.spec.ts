/**
 * Regression: issue #27 (SEP-0043 challenge)
 * Bug: invalid Stellar addresses were accepted on verification-challenge input.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerificationChallengeQueryDto } from './dto/verification-challenge.dto';

describe('regression: invalid Stellar address rejected (issue #27)', () => {
  async function validateAddress(address: string) {
    const dto = plainToInstance(VerificationChallengeQueryDto, { address });
    return validate(dto);
  }

  it('rejects non-G addresses and wrong-length keys', async () => {
    const cases = [
      'not-a-stellar-key',
      'SINVALIDSECRETKEYSHOULDFAIL0000000000000000000000000000',
      'GSHORT',
      'G' + 'A'.repeat(54), // 55 chars total — one short
      'g' + 'A'.repeat(55), // lowercase
    ];

    for (const address of cases) {
      const errors = await validateAddress(address);
      expect(errors.length).toBeGreaterThan(0);
      const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
      expect(messages.some((m) => /valid Stellar public key/i.test(m))).toBe(true);
    }
  });

  it('accepts a well-formed G... 56-char Stellar public key', async () => {
    const address = 'GA7QYNF7SOWQ3GLR2BGMZEHHHVSH3VK4UFR2QPYDQGPHK3WSALDQXJZN';
    const errors = await validateAddress(address);
    expect(errors).toHaveLength(0);
  });
});
