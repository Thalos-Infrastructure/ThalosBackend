import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { relayToTrustless } from './trustless-relay.helper';
import { formatUpstreamError } from './escrow-write.helper';
import type { ServiceType } from './dto/escrow-write.dto';

/**
 * Reads one escrow from Trustless Work.
 *
 * A dispute resolution is expressed in percentages, and only the escrow knows
 * what they are percentages *of*: the current balance for single-release, the
 * milestone's amount for multi-release. The resolver's browser must not be the
 * one to supply that number — it would be converting a share of a balance it
 * read separately, and any drift between the two lands as a Trustless Work
 * rejection after the wallet has already signed.
 *
 * Shape confirmed against a live escrow on 2026-10-18, not against the docs:
 * `amount` and `balance` come back as **numbers**, the response is an **array**,
 * and the query parameter is `contractIds[]` — a bare `contractIds` is answered
 * with `400 contractIds must be an array`, even though the OpenAPI spec names
 * it `contractIds`.
 */

export interface EscrowRoles {
  approver?: string;
  serviceProvider?: string;
  releaseSigner?: string;
  disputeResolver?: string;
  receiver?: string;
  platformAddress?: string;
}

export interface EscrowMilestoneSnapshot {
  description?: string;
  status?: string;
  /** Present on multi-release, absent on single-release. */
  amount?: number;
  approved?: boolean;
  flags?: { disputed?: boolean; released?: boolean; resolved?: boolean; approved?: boolean };
}

export interface EscrowSnapshot {
  contractId: string;
  type: ServiceType;
  /** Agreed total. Not what a resolution splits — see `resolutionTotal`. */
  amount: number;
  /** What the contract actually holds right now. */
  balance: number;
  roles: EscrowRoles;
  flags: { disputed: boolean; released: boolean; resolved: boolean };
  milestones: EscrowMilestoneSnapshot[];
  /** The asset this escrow holds, which recipients need a trustline for. */
  trustline?: { address?: string; symbol?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Upstream sends numbers here, but a numeric string must not become `NaN`. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseMilestones(raw: unknown): EscrowMilestoneSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const milestone = isRecord(entry) ? entry : {};
    const flags = isRecord(milestone.flags) ? milestone.flags : undefined;
    return {
      description: optionalString(milestone.description),
      status: optionalString(milestone.status),
      // Left undefined rather than 0: "no amount on this milestone" and "a
      // milestone worth nothing" need different answers in `resolutionTotal`.
      amount: milestone.amount === undefined ? undefined : toNumber(milestone.amount),
      approved: milestone.approved === true || flags?.approved === true,
      ...(flags
        ? {
            flags: {
              disputed: flags.disputed === true,
              released: flags.released === true,
              resolved: flags.resolved === true,
              approved: flags.approved === true,
            },
          }
        : {}),
    };
  });
}

function parseEscrow(raw: unknown): EscrowSnapshot | null {
  if (!isRecord(raw)) return null;
  const contractId = optionalString(raw.contractId);
  if (!contractId) return null;

  const roles = isRecord(raw.roles) ? raw.roles : {};
  const flags = isRecord(raw.flags) ? raw.flags : {};
  const trustline = isRecord(raw.trustline) ? raw.trustline : undefined;

  return {
    contractId,
    type: raw.type === 'multi-release' ? 'multi-release' : 'single-release',
    amount: toNumber(raw.amount),
    balance: toNumber(raw.balance),
    roles: {
      approver: optionalString(roles.approver),
      serviceProvider: optionalString(roles.serviceProvider),
      releaseSigner: optionalString(roles.releaseSigner),
      disputeResolver: optionalString(roles.disputeResolver),
      receiver: optionalString(roles.receiver),
      platformAddress: optionalString(roles.platformAddress),
    },
    flags: {
      disputed: flags.disputed === true,
      released: flags.released === true,
      resolved: flags.resolved === true,
    },
    milestones: parseMilestones(raw.milestones),
    ...(trustline
      ? {
          trustline: {
            address: optionalString(trustline.address),
            symbol: optionalString(trustline.symbol),
          },
        }
      : {}),
  };
}

export async function readEscrow(contractId: string): Promise<EscrowSnapshot> {
  const result = await relayToTrustless('GET', 'helper/get-escrow-by-contract-ids', {
    'contractIds[]': contractId,
    validateOnChain: true,
  });

  if (result.status >= 500) {
    throw new ServiceUnavailableException(
      'Could not read the escrow from Trustless Work. Try again in a moment.',
    );
  }
  if (result.status >= 400) {
    throw new BadRequestException(formatUpstreamError(result.data));
  }

  // `Array.isArray` widens an `unknown` to `any[]`, so keep the element typed.
  const payload: unknown = result.data;
  const first = Array.isArray(payload) ? (payload as unknown[])[0] : payload;
  const escrow = parseEscrow(first);
  if (!escrow) {
    throw new NotFoundException(`No escrow found for contract ${contractId}`);
  }
  return escrow;
}

/**
 * What a resolution's percentages are percentages of.
 *
 * single-release splits the whole balance and must total it exactly.
 * multi-release splits one milestone and must not exceed its amount — so the
 * balance is the wrong number there, and using it would let a resolution of one
 * milestone hand out the funds reserved for every other.
 */
export function resolutionTotal(
  escrow: EscrowSnapshot,
  type: ServiceType,
  milestoneIndex?: string,
): number {
  if (type === 'single-release') {
    if (escrow.balance <= 0) {
      throw new BadRequestException(
        'This escrow holds no funds, so there is nothing to distribute.',
      );
    }
    return escrow.balance;
  }

  const index = Number(milestoneIndex);
  if (!Number.isInteger(index) || index < 0 || index >= escrow.milestones.length) {
    throw new BadRequestException(
      `Milestone ${milestoneIndex ?? '(none)'} does not exist on this escrow.`,
    );
  }

  const amount = escrow.milestones[index].amount;
  if (amount === undefined || amount <= 0) {
    throw new BadRequestException(
      `Milestone ${index} has no amount, so there is nothing to distribute.`,
    );
  }
  // Never hand out more than the contract holds, whatever the milestone says.
  return Math.min(amount, escrow.balance > 0 ? escrow.balance : amount);
}

/**
 * Refuse a resolution the chain would refuse anyway, before the wallet signs.
 *
 * Only the escrow's own `disputeResolver` can resolve it, and only while it is
 * disputed. Both are enforced on-chain; checking here means the resolver is
 * told why instead of watching a signed transaction bounce.
 */
export function assertResolvable(
  escrow: EscrowSnapshot,
  dto: { type: ServiceType; disputeResolver: string; milestoneIndex?: string },
): void {
  if (escrow.type !== dto.type) {
    throw new BadRequestException(
      `This escrow is ${escrow.type}, not ${dto.type}. Resolving it needs the other endpoint.`,
    );
  }

  const expected = escrow.roles.disputeResolver;
  if (expected && expected.toUpperCase() !== dto.disputeResolver.trim().toUpperCase()) {
    throw new BadRequestException(
      'This wallet is not the dispute resolver of this escrow, so it cannot resolve it.',
    );
  }

  if (escrow.flags.resolved) {
    throw new BadRequestException('This dispute was already resolved on-chain.');
  }

  // Single-release carries the dispute on the escrow itself. Multi-release
  // carries it per milestone, and that flag is not verified here yet: it is
  // what the multi-release work covers, and refusing on a shape this code has
  // not seen would block resolutions that are perfectly valid.
  if (dto.type === 'single-release' && !escrow.flags.disputed) {
    throw new BadRequestException('This escrow is not in dispute, so there is nothing to resolve.');
  }
}
