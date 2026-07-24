import {
  validateAgreement,
  validateTransition,
  validateAgreementConsistency,
  type AgreementInput,
  type AgreementSnapshot,
} from './agreement.validator';
import { AGREEMENT_STATUSES, AGREEMENT_TRANSITIONS, type AgreementStatus } from './agreement-lifecycle';

const VALID_INPUT: AgreementInput = {
  title: 'Test agreement',
  amount: '100.00',
  asset: 'USDC',
  participants: [{ wallet_address: 'GABCDEF1234567890' }],
};

const VALID_MULTI_INPUT: AgreementInput = {
  title: 'Multi milestone agreement',
  amount: '100.00',
  asset: 'USDC',
  agreement_type: 'multi',
  milestones: [
    { description: 'Design', amount: '50.00', status: 'pending' },
    { description: 'Build', amount: '50.00', status: 'pending' },
  ],
  participants: [{ wallet_address: 'GABCDEF1234567890' }],
};

/* ------------------------------------------------------------------ */
/*  validateAgreement                                                   */
/* ------------------------------------------------------------------ */

describe('validateAgreement', () => {
  describe('title', () => {
    it('rejects empty title', () => {
      const result = validateAgreement({ ...VALID_INPUT, title: '' });
      expect(result.success).toBe(false);
      expect(result.error!.details).toContainEqual(
        expect.objectContaining({ field: 'title', code: 'REQUIRED' }),
      );
    });

    it('rejects whitespace-only title', () => {
      const result = validateAgreement({ ...VALID_INPUT, title: '   ' });
      expect(result.success).toBe(false);
    });

    it('accepts valid title', () => {
      const result = validateAgreement(VALID_INPUT);
      expect(result.success).toBe(true);
    });
  });

  describe('description', () => {
    it('rejects empty description when explicitly provided', () => {
      const result = validateAgreement({ ...VALID_INPUT, description: '' });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].field).toBe('description');
    });

    it('accepts undefined description', () => {
      const result = validateAgreement({ ...VALID_INPUT, description: undefined });
      expect(result.success).toBe(true);
    });
  });

  describe('amount', () => {
    it('rejects non-numeric amount', () => {
      const result = validateAgreement({ ...VALID_INPUT, amount: 'abc' });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].code).toBe('INVALID_AMOUNT');
    });

    it('rejects zero amount', () => {
      const result = validateAgreement({ ...VALID_INPUT, amount: '0' });
      expect(result.success).toBe(false);
    });

    it('rejects zero decimal amount', () => {
      const result = validateAgreement({ ...VALID_INPUT, amount: '0.00' });
      expect(result.success).toBe(false);
    });

    it('rejects negative amount', () => {
      const result = validateAgreement({ ...VALID_INPUT, amount: '-50.00' });
      expect(result.success).toBe(false);
    });

    it('accepts positive amount', () => {
      const result = validateAgreement(VALID_INPUT);
      expect(result.success).toBe(true);
    });

    it('accepts integer amount string', () => {
      const result = validateAgreement({ ...VALID_INPUT, amount: '100' });
      expect(result.success).toBe(true);
    });
  });

  describe('asset', () => {
    it('rejects non-USDC asset', () => {
      const result = validateAgreement({ ...VALID_INPUT, asset: 'EURC' });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].code).toBe('INVALID_ASSET');
    });

    it('accepts undefined asset (defaults to USDC)', () => {
      const result = validateAgreement({ ...VALID_INPUT, asset: undefined });
      expect(result.success).toBe(true);
    });

    it('accepts USDC explicitly', () => {
      const result = validateAgreement({ ...VALID_INPUT, asset: 'USDC' });
      expect(result.success).toBe(true);
    });
  });

  describe('participants', () => {
    it('rejects empty participants', () => {
      const result = validateAgreement({ ...VALID_INPUT, participants: [] });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].code).toBe('REQUIRED');
    });

    it('rejects participant with empty wallet_address', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        participants: [{ wallet_address: '' }],
      });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].code).toBe('REQUIRED');
    });

    it('accepts participant with wallet_address and role', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        participants: [{ wallet_address: 'GXYZ', role: 'payer' }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('milestones', () => {
    it('accepts agreement without milestones', () => {
      const result = validateAgreement(VALID_INPUT);
      expect(result.success).toBe(true);
    });

    it('accepts valid single milestone', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        milestones: [{ description: 'Full delivery', amount: '100.00', status: 'pending' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid multi-milestone agreement', () => {
      const result = validateAgreement(VALID_MULTI_INPUT);
      expect(result.success).toBe(true);
    });

    it('rejects milestone with empty description', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        milestones: [{ description: '', amount: '100.00', status: 'pending' }],
      });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].field).toBe('milestones[0].description');
    });

    it('rejects milestone with non-positive amount', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        milestones: [{ description: 'Work', amount: '0.00', status: 'pending' }],
      });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].code).toBe('INVALID_AMOUNT');
    });

    it('rejects milestone with undefined amount and still validates other milestones', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        amount: '100.00',
        agreement_type: 'multi',
        milestones: [
          { description: 'Design', amount: undefined, status: 'pending' },
          { description: 'Build', amount: '50.00', status: 'pending' },
        ],
      });
      expect(result.success).toBe(false);
      const amountErrors = result.error!.details.filter((d) => d.field === 'milestones[0].amount');
      expect(amountErrors).toHaveLength(1);
      expect(amountErrors[0].code).toBe('REQUIRED');
      const descErrors = result.error!.details.filter((d) => d.field === 'milestones[1].description');
      expect(descErrors).toHaveLength(0);
    });

    it('rejects milestone sum mismatch', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        amount: '100.00',
        agreement_type: 'multi',
        milestones: [
          { description: 'Design', amount: '70.00', status: 'pending' },
          { description: 'Build', amount: '40.00', status: 'pending' },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].code).toBe('MILESTONE_SUM_MISMATCH');
    });

    it('rejects agreement_type "single" with multiple milestones', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        amount: '100.00',
        agreement_type: 'single',
        milestones: [
          { description: 'Design', amount: '50.00' },
          { description: 'Build', amount: '50.00' },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].code).toBe('INVALID_AGREEMENT_TYPE');
    });

    it('rejects multiple milestones when agreement_type is undefined (MUST be "multi")', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        amount: '100.00',
        agreement_type: undefined,
        milestones: [
          { description: 'Design', amount: '50.00' },
          { description: 'Build', amount: '50.00' },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error!.details.some((d) => d.code === 'INVALID_AGREEMENT_TYPE')).toBe(true);
    });

    it('rejects agreement_type "multi" with single milestone', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        agreement_type: 'multi',
        milestones: [{ description: 'All', amount: '100.00' }],
      });
      expect(result.success).toBe(false);
      expect(result.error!.details[0].code).toBe('INVALID_AGREEMENT_TYPE');
    });
  });

  describe('standardized error shape', () => {
    it('returns success: true for valid input', () => {
      const result = validateAgreement(VALID_INPUT);
      expect(result).toEqual({ success: true });
    });

    it('returns code + details array on error', () => {
      const result = validateAgreement({
        ...VALID_INPUT,
        title: '',
        amount: 'abc',
        participants: [],
      });
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(result.error!.details)).toBe(true);
      expect(result.error!.details.length).toBeGreaterThanOrEqual(3);
      for (const d of result.error!.details) {
        expect(d).toHaveProperty('field');
        expect(d).toHaveProperty('code');
        expect(d).toHaveProperty('message');
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/*  validateTransition                                                  */
/* ------------------------------------------------------------------ */

describe('validateTransition', () => {
  const validPairs: Array<[AgreementStatus, AgreementStatus]> = [];
  const invalidPairs: Array<[AgreementStatus, AgreementStatus]> = [];

  for (const from of AGREEMENT_STATUSES) {
    for (const to of AGREEMENT_STATUSES) {
      if (AGREEMENT_TRANSITIONS[from].includes(to)) {
        validPairs.push([from, to]);
      } else {
        invalidPairs.push([from, to]);
      }
    }
  }

  it.each(validPairs)('allows %s → %s', (from, to) => {
    const result = validateTransition(from, to);
    expect(result).toEqual({ success: true });
  });

  it.each(invalidPairs)('rejects %s → %s', (from, to) => {
    const result = validateTransition(from, to);
    expect(result.success).toBe(false);
    expect(result.error!.details[0].code).toBe('INVALID_TRANSITION');
  });

  it('rejects unknown from status', () => {
    const result = validateTransition('archived', 'active');
    expect(result.success).toBe(false);
    expect(result.error!.details[0].code).toBe('INVALID_STATUS');
  });

  it('rejects unknown to status', () => {
    const result = validateTransition('active', 'archived');
    expect(result.success).toBe(false);
    expect(result.error!.details[0].code).toBe('INVALID_STATUS');
  });

  it('error details include both from and to in the message', () => {
    const result = validateTransition('pending', 'completed');
    expect(result.success).toBe(false);
    expect(result.error!.details[0].message).toContain('pending');
    expect(result.error!.details[0].message).toContain('completed');
  });
});

/* ------------------------------------------------------------------ */
/*  validateAgreementConsistency                                        */
/* ------------------------------------------------------------------ */

describe('validateAgreementConsistency', () => {
  const CONSISTENT_AGREEMENT: AgreementSnapshot = {
    amount: '100.00',
    milestones: [
      { description: 'Design', amount: '50.00' },
      { description: 'Build', amount: '50.00' },
    ],
  };

  it('accepts a consistent agreement', () => {
    const result = validateAgreementConsistency(CONSISTENT_AGREEMENT);
    expect(result).toEqual({ success: true });
  });

  it('accepts an agreement without milestones', () => {
    const result = validateAgreementConsistency({ amount: '100.00', milestones: [] });
    expect(result).toEqual({ success: true });
  });

  it('rejects sum mismatch', () => {
    const result = validateAgreementConsistency({
      amount: '100.00',
      milestones: [
        { description: 'Design', amount: '70.00' },
        { description: 'Build', amount: '40.00' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error!.details[0].code).toBe('MILESTONE_SUM_MISMATCH');
  });

  it('rejects non-positive total amount', () => {
    const result = validateAgreementConsistency({ amount: '0.00', milestones: [] });
    expect(result.success).toBe(false);
    expect(result.error!.details[0].code).toBe('INCONSISTENT_AMOUNT');
  });

  it('rejects milestone with empty description', () => {
    const result = validateAgreementConsistency({
      amount: '100.00',
      milestones: [{ description: '', amount: '100.00' }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.details[0].code).toBe('INCONSISTENT');
  });

  it('rejects milestone with non-positive amount', () => {
    const result = validateAgreementConsistency({
      amount: '100.00',
      milestones: [{ description: 'Work', amount: '0.00' }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.details[0].code).toBe('INCONSISTENT_AMOUNT');
  });

  it('returns multiple errors for multiple inconsistencies', () => {
    const result = validateAgreementConsistency({
      amount: '0.00',
      milestones: [
        { description: '', amount: '0.00' },
        { description: '', amount: '0.00' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error!.details.length).toBeGreaterThanOrEqual(4);
  });
});
