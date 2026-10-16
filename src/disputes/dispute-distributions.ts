/**
 * Turns a dispute resolution expressed in percentages into the `distributions`
 * array Trustless Work expects.
 *
 * The UI speaks percentages — a resolver decides "60/40", not "9.0000000 and
 * 6.0000000 USDC". Only the backend knows the escrow's actual balance, so the
 * conversion belongs here: a frontend doing it would have to read the balance
 * and reproduce this arithmetic, and any drift between the two ends as a
 * Trustless Work rejection the user cannot interpret.
 *
 * Contract, from `.claude/skills/trustless-work-dev/skills/api/`:
 *
 *   single-release — "The sum of distributions must equal the current escrow
 *                     balance when resolving an escrow dispute"
 *   multi-release  — "must be positive and must not exceed the milestone
 *                     amount (they do not have to equal the full balance)"
 *
 * Fees are not our arithmetic: `platformFee` is a rate, and the contract
 * deducts the platform and protocol fees itself at release. We split the
 * balance as it stands.
 */

/** Stellar holds 7 decimal places; everything here is computed in those units. */
const STROOPS_PER_UNIT = 10_000_000;

export type EscrowKind = 'single-release' | 'multi-release';

export interface PercentageAllocation {
  /** Stellar address that receives this share. */
  address: string;
  /** 0–100. The set must total exactly 100. */
  percentage: number;
}

export interface Distribution {
  address: string;
  amount: number;
}

export class DistributionError extends Error {}

function toStroops(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new DistributionError(`${field} must be a finite number`);
  }
  // Round rather than truncate: a balance arriving as 14.999999999999998 is
  // 15, and truncating would lose a stroop that the sum then cannot recover.
  return Math.round(value * STROOPS_PER_UNIT);
}

function fromStroops(stroops: number): number {
  // Back through an integer count of stroops, so the result cannot carry a
  // float artefact that makes the sum miss the balance by 1e-16.
  return Number((stroops / STROOPS_PER_UNIT).toFixed(7));
}

function assertAllocations(allocations: PercentageAllocation[]): void {
  if (allocations.length === 0) {
    throw new DistributionError('A resolution needs at least one allocation');
  }

  for (const allocation of allocations) {
    if (!allocation.address?.trim()) {
      throw new DistributionError('Every allocation needs an address');
    }
    if (!Number.isFinite(allocation.percentage)) {
      throw new DistributionError(`Percentage for ${allocation.address} must be a number`);
    }
    if (allocation.percentage < 0 || allocation.percentage > 100) {
      throw new DistributionError(`Percentage for ${allocation.address} must be between 0 and 100`);
    }
  }

  const addresses = allocations.map((a) => a.address.trim());
  if (new Set(addresses).size !== addresses.length) {
    // Two shares for one address would halve that party's say in how the
    // remainder lands below, and reads as a mistake rather than an intent.
    throw new DistributionError('The same address appears twice in the allocations');
  }

  const total = allocations.reduce((sum, a) => sum + a.percentage, 0);
  // Percentages arrive from a form, so tolerate float noise but not a real gap.
  if (Math.abs(total - 100) > 1e-9) {
    throw new DistributionError(`Percentages must total 100, got ${total}`);
  }
}

/**
 * Split `total` by the given percentages, exactly.
 *
 * Floor each share and hand the leftover stroops to the largest share. Flooring
 * alone loses up to one stroop per allocation, and for single-release the sum
 * must equal the balance to the stroop or Trustless Work rejects the whole
 * operation. The largest share absorbs it so the adjustment is the smallest
 * possible in relative terms, and is deterministic for a given input.
 */
function splitStroops(totalStroops: number, allocations: PercentageAllocation[]): number[] {
  const shares = allocations.map((allocation) =>
    Math.floor((totalStroops * allocation.percentage) / 100),
  );

  const distributed = shares.reduce((sum, share) => sum + share, 0);
  const remainder = totalStroops - distributed;
  if (remainder === 0) return shares;

  // Ties go to the earliest allocation, so the result does not depend on sort
  // stability.
  let largest = 0;
  for (let i = 1; i < shares.length; i++) {
    if (shares[i] > shares[largest]) largest = i;
  }
  shares[largest] += remainder;
  return shares;
}

export interface BuildDistributionsInput {
  escrowType: EscrowKind;
  /**
   * single-release: the escrow's current balance, which the distributions must
   * total exactly. multi-release: the disputed milestone's amount, which they
   * must not exceed.
   */
  total: number;
  allocations: PercentageAllocation[];
}

/**
 * The `distributions` payload for a dispute resolution.
 *
 * Allocations of 0% are dropped: Trustless Work requires positive amounts on
 * multi-release, and a zero-value transfer to a party that gets nothing is
 * noise on single-release. A 100/0 resolution therefore sends one distribution.
 *
 * Note for callers: every address here must already hold a USDC trustline, or
 * the funds cannot reach it. That is not checked here — it needs a network
 * read, and this stays a pure function.
 */
export function buildDistributions(input: BuildDistributionsInput): Distribution[] {
  assertAllocations(input.allocations);

  const totalStroops = toStroops(input.total, 'total');
  if (totalStroops <= 0) {
    throw new DistributionError('There is nothing to distribute: the total is zero');
  }

  const shares = splitStroops(totalStroops, input.allocations);

  const distributions = input.allocations
    .map((allocation, index) => ({
      address: allocation.address.trim(),
      stroops: shares[index],
    }))
    .filter((entry) => entry.stroops > 0)
    .map((entry) => ({ address: entry.address, amount: fromStroops(entry.stroops) }));

  if (distributions.length === 0) {
    throw new DistributionError('Every allocation rounded to zero');
  }

  assertWithinContract(input, distributions, totalStroops);
  return distributions;
}

/**
 * Re-check the result against Trustless Work's own rule for this escrow type.
 *
 * The arithmetic above should make this impossible, which is the point: if a
 * later change breaks it, it fails here with the reason rather than as a 400
 * from Trustless Work after the resolver has already signed.
 */
function assertWithinContract(
  input: BuildDistributionsInput,
  distributions: Distribution[],
  totalStroops: number,
): void {
  const sum = distributions.reduce((acc, d) => acc + toStroops(d.amount, 'amount'), 0);

  if (input.escrowType === 'single-release' && sum !== totalStroops) {
    throw new DistributionError(
      `Distributions must total the escrow balance exactly: expected ${fromStroops(totalStroops)}, got ${fromStroops(sum)}`,
    );
  }
  if (input.escrowType === 'multi-release' && sum > totalStroops) {
    throw new DistributionError(
      `Distributions must not exceed the milestone amount: limit ${fromStroops(totalStroops)}, got ${fromStroops(sum)}`,
    );
  }
}

/**
 * The two-party split the first resolution mechanism offers, as allocations.
 *
 * Kept separate from `buildDistributions` so the arbitrary-split arithmetic is
 * not shaped by today's two-party UI: 50/50, 100/0 and anything between are one
 * case, and a third party later is a caller change rather than a rewrite.
 */
export function twoPartyAllocations(params: {
  approver: string;
  serviceProvider: string;
  /** Share for the approver, 0–100. The service provider gets the rest. */
  approverPercentage: number;
}): PercentageAllocation[] {
  return [
    { address: params.approver, percentage: params.approverPercentage },
    { address: params.serviceProvider, percentage: 100 - params.approverPercentage },
  ];
}
