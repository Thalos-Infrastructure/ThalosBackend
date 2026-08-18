import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export type ServiceType = 'single-release' | 'multi-release';

const SERVICE_TYPES: ServiceType[] = ['single-release', 'multi-release'];

/* ---------------- Create escrow ---------------- */

class CreateEscrowRolesDto {
  @IsString()
  approver: string;

  @IsString()
  serviceProvider: string;

  @IsString()
  releaseSigner: string;

  /** Requerido para single-release; el receiver de cada milestone en multi-release es el signer. */
  @IsOptional()
  @IsString()
  receiver?: string;
}

class CreateEscrowMilestoneDto {
  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  amount?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateEscrowDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  amount: string;

  @IsString()
  platformFee: string;

  /** Wallet que firma; debe coincidir con la wallet del usuario del JWT. */
  @IsString()
  signer: string;

  @IsIn(SERVICE_TYPES)
  serviceType: ServiceType;

  @ValidateNested()
  @Type(() => CreateEscrowRolesDto)
  roles: CreateEscrowRolesDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEscrowMilestoneDto)
  milestones: CreateEscrowMilestoneDto[];
}

/* ---------------- Fund escrow ---------------- */

export class FundEscrowDto {
  @IsString()
  contractId: string;

  @IsString()
  signer: string;

  @IsNumber()
  amount: number;

  @IsIn(SERVICE_TYPES)
  type: ServiceType;
}

/* ---------------- Approve milestone ---------------- */

export class ApproveMilestoneDto {
  @IsString()
  contractId: string;

  @IsString()
  milestoneIndex: string;

  @IsString()
  approver: string;

  @IsIn(SERVICE_TYPES)
  type: ServiceType;
}

/* ---------------- Change milestone status ---------------- */

/**
 * @deprecated Use `PATCH /v1/agreements/:id/milestones` instead (canonical evidence
 * endpoint — see GF-4-BE / issue #142). This endpoint remains for backward compatibility
 * with existing TW-proxy callers but will be removed in a future release.
 *
 * Legacy TW values (e.g. "completed") are normalized to the canonical Thalos enum
 * before being forwarded to Trustless Work. See `normalizeMilestoneStatus()`.
 */
export class ChangeMilestoneStatusDto {
  @IsString()
  contractId: string;

  @IsString()
  milestoneIndex: string;

  @IsString()
  newEvidence: string;

  /**
   * Milestone status to set. Accepts canonical Thalos values
   * (`pending`, `approved`, `released`, `rejected`) **and** legacy Trustless Work
   * values (`completed` → mapped to `released`).
   */
  @IsString()
  newStatus: string;

  @IsString()
  serviceProvider: string;

  @IsIn(SERVICE_TYPES)
  type: ServiceType;
}

/* ---------------- Release funds ---------------- */

export class ReleaseFundsDto {
  @IsString()
  contractId: string;

  @IsString()
  releaseSigner: string;

  @IsIn(SERVICE_TYPES)
  type: ServiceType;

  @IsOptional()
  @IsString()
  milestoneIndex?: string;
}

/* ---------------- Dispute milestone ---------------- */

export class DisputeMilestoneDto {
  @IsString()
  contractId: string;

  @IsIn(SERVICE_TYPES)
  type: ServiceType;

  /** Required for multi-release (identifies the milestone); ignored for single-release. */
  @ValidateIf((o: DisputeMilestoneDto) => o.type === 'multi-release')
  @IsString()
  milestoneIndex?: string;

  /** Approver o service provider; debe coincidir con la wallet del JWT. */
  @IsString()
  signer: string;
}

/* ---------------- Send signed transaction ---------------- */

export class SendTransactionDto {
  @IsString()
  signedXdr: string;
}
