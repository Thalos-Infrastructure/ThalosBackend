import { BadRequestException } from '@nestjs/common';
import { relayToTrustless } from './trustless-relay.helper';
import type {
  ApproveMilestoneDto,
  ChangeMilestoneStatusDto,
  CreateEscrowDto,
  DisputeMilestoneDto,
  FundEscrowDto,
  ReleaseFundsDto,
  SendTransactionDto,
  ServiceType,
} from './dto/escrow-write.dto';

// Defaults de testnet (mismos que usa el frontend); sobreescribibles por env.
const DEFAULT_PLATFORM_ADDRESS = 'GBTTKTSBLHGMRY3T65JXT423MHQZXTD26TTHQEY5HNF2KWFFDKKVHVPD';
const DEFAULT_DISPUTE_RESOLVER = 'GB6MP3L6UGIDY6O6MXNLSKHLXT2T2TCMPZIZGUTOGYKOLHW7EORWMFCK';
const DEFAULT_TRUSTLINE_USDC = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function getPlatformAddress(): string {
  return process.env.PLATFORM_ADDRESS || DEFAULT_PLATFORM_ADDRESS;
}

function getDisputeResolver(): string {
  return process.env.DISPUTE_RESOLVER || DEFAULT_DISPUTE_RESOLVER;
}

function getTrustline(): { symbol: string; address: string } {
  return {
    symbol: 'USDC',
    address: process.env.TRUSTLINE_USDC_ADDRESS || DEFAULT_TRUSTLINE_USDC,
  };
}

function generateEngagementId(type: 'MULTIRELEASE' | 'SINGLERELEASE'): string {
  return `THALOS-v2-${type}-${Date.now().toString(36).toUpperCase()}`;
}

function buildRoles(
  serviceType: ServiceType,
  roles: {
    approver: string;
    serviceProvider: string;
    releaseSigner: string;
    receiver?: string;
  },
) {
  const base = {
    approver: roles.approver,
    serviceProvider: roles.serviceProvider,
    platformAddress: getPlatformAddress(),
    releaseSigner: roles.releaseSigner,
    disputeResolver: getDisputeResolver(),
  };

  return serviceType === 'single-release' ? { ...base, receiver: roles.receiver } : base;
}

function buildAgreementBody(dto: CreateEscrowDto) {
  const isMulti = dto.serviceType === 'multi-release';

  const base = {
    signer: dto.signer,
    engagementId: generateEngagementId(isMulti ? 'MULTIRELEASE' : 'SINGLERELEASE'),
    title: dto.title,
    description: dto.description,
    roles: buildRoles(dto.serviceType, dto.roles),
    platformFee: Number(dto.platformFee),
    trustline: getTrustline(),
  };

  if (isMulti) {
    return {
      ...base,
      milestones: dto.milestones.map((m) => ({
        description: m.description,
        amount: Number(m.amount),
        status: m.status,
        receiver: dto.signer,
      })),
    };
  }

  return {
    ...base,
    amount: Number(dto.amount),
    milestones: dto.milestones.map((m) => ({ description: m.description })),
  };
}

/**
 * POST a Trustless Work y devuelve la respuesta tal cual (p. ej. { unsignedTransaction }).
 * Lanza BadRequestException si el upstream falla.
 */
async function relayWrite(path: string, body: unknown): Promise<unknown> {
  const result = await relayToTrustless('POST', path, undefined, body);
  if (result.status >= 400) {
    throw new BadRequestException(result.data);
  }
  return result.data;
}

/* =====================================================
   WRITE ACTIONS (paridad con la API de Trustless Work)
===================================================== */

export function createEscrow(dto: CreateEscrowDto): Promise<unknown> {
  const path =
    dto.serviceType === 'multi-release' ? 'deployer/multi-release' : 'deployer/single-release';
  return relayWrite(path, buildAgreementBody(dto));
}

export function fundEscrow(dto: FundEscrowDto): Promise<unknown> {
  return relayWrite(`escrow/${dto.type}/fund-escrow`, {
    contractId: dto.contractId,
    signer: dto.signer,
    amount: dto.amount,
  });
}

export function approveMilestone(dto: ApproveMilestoneDto): Promise<unknown> {
  return relayWrite(`escrow/${dto.type}/approve-milestone`, {
    contractId: dto.contractId,
    milestoneIndex: dto.milestoneIndex,
    approver: dto.approver,
  });
}

export function changeMilestoneStatus(dto: ChangeMilestoneStatusDto): Promise<unknown> {
  return relayWrite(`escrow/${dto.type}/change-milestone-status`, {
    contractId: dto.contractId,
    milestoneIndex: dto.milestoneIndex,
    newEvidence: dto.newEvidence,
    newStatus: dto.newStatus,
    serviceProvider: dto.serviceProvider,
  });
}

export function releaseFunds(dto: ReleaseFundsDto): Promise<unknown> {
  const path =
    dto.type === 'single-release'
      ? `escrow/${dto.type}/release-funds`
      : `escrow/${dto.type}/release-milestone-funds`;
  return relayWrite(path, {
    contractId: dto.contractId,
    releaseSigner: dto.releaseSigner,
    milestoneIndex: dto.milestoneIndex,
  });
}

export function disputeMilestone(dto: DisputeMilestoneDto): Promise<unknown> {
  return relayWrite('escrow/multi-release/dispute-milestone', {
    contractId: dto.contractId,
    milestoneIndex: dto.milestoneIndex,
    signer: dto.signer,
  });
}

export function sendTransaction(dto: SendTransactionDto): Promise<unknown> {
  // El XDR ya viene firmado por la wallet del usuario; TW valida el firmante on-chain.
  return relayWrite('helper/send-transaction', { signedXdr: dto.signedXdr });
}
