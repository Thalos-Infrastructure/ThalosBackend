import {
  buildDistributions,
  DistributionError,
  twoPartyAllocations,
  type PercentageAllocation,
} from './dispute-distributions';

const APPROVER = 'GAPPROVER';
const PROVIDER = 'GPROVIDER';
const THIRD = 'GTHIRD';

/** Sum in stroops, so the assertion cannot be the float arithmetic under test. */
const sumStroops = (distributions: { amount: number }[]): number =>
  distributions.reduce((total, d) => total + Math.round(d.amount * 10_000_000), 0);

const split = (approverPercentage: number): PercentageAllocation[] =>
  twoPartyAllocations({ approver: APPROVER, serviceProvider: PROVIDER, approverPercentage });

describe('buildDistributions — the splits the first mechanism offers', () => {
  it('splits a balance in half', () => {
    const distributions = buildDistributions({
      escrowType: 'single-release',
      total: 15,
      allocations: split(50),
    });

    expect(distributions).toEqual([
      { address: APPROVER, amount: 7.5 },
      { address: PROVIDER, amount: 7.5 },
    ]);
  });

  it('gives everything to one party, and sends no zero-value transfer to the other', () => {
    // Trustless Work requires positive amounts on multi-release, and a 0 to a
    // party that gets nothing is noise on single-release.
    expect(
      buildDistributions({ escrowType: 'single-release', total: 15, allocations: split(0) }),
    ).toEqual([{ address: PROVIDER, amount: 15 }]);

    expect(
      buildDistributions({ escrowType: 'single-release', total: 15, allocations: split(100) }),
    ).toEqual([{ address: APPROVER, amount: 15 }]);
  });

  it('handles an arbitrary split', () => {
    expect(
      buildDistributions({ escrowType: 'single-release', total: 100, allocations: split(60) }),
    ).toEqual([
      { address: APPROVER, amount: 60 },
      { address: PROVIDER, amount: 40 },
    ]);
  });
});

describe('buildDistributions — the sum must land exactly on the balance', () => {
  it('loses nothing on a balance that does not divide evenly', () => {
    // 3.5 USDC is 35,000,000 stroops; half is 17,500,000 each — exact.
    const distributions = buildDistributions({
      escrowType: 'single-release',
      total: 3.5,
      allocations: split(50),
    });
    expect(sumStroops(distributions)).toBe(35_000_000);
  });

  it('absorbs the leftover stroop into the largest share', () => {
    // A third of 10 USDC repeats; flooring each share would leave a stroop
    // behind and Trustless Work rejects the whole operation for it.
    const distributions = buildDistributions({
      escrowType: 'single-release',
      total: 10,
      allocations: [
        { address: APPROVER, percentage: 33.333333 },
        { address: PROVIDER, percentage: 33.333333 },
        { address: THIRD, percentage: 33.333334 },
      ],
    });

    expect(sumStroops(distributions)).toBe(100_000_000);
    expect(distributions).toHaveLength(3);
  });

  it('lands exactly across a range of awkward balances and splits', () => {
    const balances = [0.0000001, 0.3, 1, 3.5, 7.77, 15, 99.9999999, 1234.5678901];
    const percentages = [0, 1, 33, 50, 60, 99, 100];

    for (const total of balances) {
      for (const approverPercentage of percentages) {
        const distributions = buildDistributions({
          escrowType: 'single-release',
          total,
          allocations: split(approverPercentage),
        });
        expect(sumStroops(distributions)).toBe(Math.round(total * 10_000_000));
      }
    }
  });

  it('rounds a balance that arrives with float noise to the stroop it means', () => {
    // 14.999999999999998 is 15; truncating would lose a stroop the sum then
    // cannot recover.
    const distributions = buildDistributions({
      escrowType: 'single-release',
      total: 14.999999999999998,
      allocations: split(50),
    });
    expect(sumStroops(distributions)).toBe(150_000_000);
  });

  it('is deterministic: the same input gives the same split every time', () => {
    const once = buildDistributions({
      escrowType: 'single-release',
      total: 10,
      allocations: [
        { address: APPROVER, percentage: 33.333333 },
        { address: PROVIDER, percentage: 33.333333 },
        { address: THIRD, percentage: 33.333334 },
      ],
    });
    for (let i = 0; i < 5; i++) {
      expect(
        buildDistributions({
          escrowType: 'single-release',
          total: 10,
          allocations: [
            { address: APPROVER, percentage: 33.333333 },
            { address: PROVIDER, percentage: 33.333333 },
            { address: THIRD, percentage: 33.333334 },
          ],
        }),
      ).toEqual(once);
    }
  });
});

describe('buildDistributions — the rule differs by escrow type', () => {
  it('multi-release is capped by the milestone amount, not the balance', () => {
    // "must be positive and must not exceed the milestone amount (they do not
    // have to equal the full balance)"
    const distributions = buildDistributions({
      escrowType: 'multi-release',
      total: 5,
      allocations: split(50),
    });
    expect(sumStroops(distributions)).toBe(50_000_000);
  });

  it('every amount is positive on multi-release', () => {
    const distributions = buildDistributions({
      escrowType: 'multi-release',
      total: 5,
      allocations: split(100),
    });
    expect(distributions.every((d) => d.amount > 0)).toBe(true);
  });
});

describe('buildDistributions — refusals', () => {
  it('refuses percentages that do not total 100', () => {
    expect(() =>
      buildDistributions({
        escrowType: 'single-release',
        total: 10,
        allocations: [
          { address: APPROVER, percentage: 40 },
          { address: PROVIDER, percentage: 40 },
        ],
      }),
    ).toThrow(/must total 100/);
  });

  it('tolerates float noise in the percentages but not a real gap', () => {
    expect(() =>
      buildDistributions({
        escrowType: 'single-release',
        total: 10,
        allocations: [
          { address: APPROVER, percentage: 33.333333333 },
          { address: PROVIDER, percentage: 33.333333333 },
          { address: THIRD, percentage: 33.333333334 },
        ],
      }),
    ).not.toThrow();
  });

  it('refuses a percentage outside 0–100', () => {
    for (const percentage of [-1, 101]) {
      expect(() =>
        buildDistributions({
          escrowType: 'single-release',
          total: 10,
          allocations: [
            { address: APPROVER, percentage },
            { address: PROVIDER, percentage: 100 - percentage },
          ],
        }),
      ).toThrow(DistributionError);
    }
  });

  it('refuses the same address twice', () => {
    // Two shares for one party would halve its say in where the remainder
    // lands, and reads as a mistake rather than an intent.
    expect(() =>
      buildDistributions({
        escrowType: 'single-release',
        total: 10,
        allocations: [
          { address: APPROVER, percentage: 50 },
          { address: APPROVER, percentage: 50 },
        ],
      }),
    ).toThrow(/appears twice/);
  });

  it('refuses an empty address', () => {
    expect(() =>
      buildDistributions({
        escrowType: 'single-release',
        total: 10,
        allocations: [
          { address: '  ', percentage: 50 },
          { address: PROVIDER, percentage: 50 },
        ],
      }),
    ).toThrow(/needs an address/);
  });

  it('refuses a zero balance instead of producing an empty payload', () => {
    expect(() =>
      buildDistributions({ escrowType: 'single-release', total: 0, allocations: split(50) }),
    ).toThrow(/nothing to distribute/);
  });

  it('refuses a total that is not a number', () => {
    for (const total of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        buildDistributions({ escrowType: 'single-release', total, allocations: split(50) }),
      ).toThrow(DistributionError);
    }
  });

  it('refuses an empty allocation list', () => {
    expect(() =>
      buildDistributions({ escrowType: 'single-release', total: 10, allocations: [] }),
    ).toThrow(/at least one allocation/);
  });

  it('trims addresses so a stray space is not a different party', () => {
    expect(
      buildDistributions({
        escrowType: 'single-release',
        total: 10,
        allocations: [{ address: `  ${APPROVER}  `, percentage: 100 }],
      }),
    ).toEqual([{ address: APPROVER, amount: 10 }]);
  });
});

describe('twoPartyAllocations', () => {
  it('gives the service provider whatever the approver does not take', () => {
    expect(
      twoPartyAllocations({
        approver: APPROVER,
        serviceProvider: PROVIDER,
        approverPercentage: 60,
      }),
    ).toEqual([
      { address: APPROVER, percentage: 60 },
      { address: PROVIDER, percentage: 40 },
    ]);
  });

  it('covers the three named cases through the one arbitrary split', () => {
    // 50/50, 100/0 and 0/100 are presets of a single field, not separate modes.
    for (const [approverPercentage, expected] of [
      [50, 50],
      [100, 0],
      [0, 100],
    ] as const) {
      const [, provider] = twoPartyAllocations({
        approver: APPROVER,
        serviceProvider: PROVIDER,
        approverPercentage,
      });
      expect(provider.percentage).toBe(expected);
    }
  });
});
