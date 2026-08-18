import { IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { MILESTONE_STATUSES, type MilestoneStatus } from '../../common/milestone-status';

/**
 * Canonical evidence + milestone update endpoint.
 *
 * This is the **authoritative** path for submitting evidence and changing
 * milestone statuses. The deprecated alternative is
 * `POST /v1/escrows/change-milestone-status` (see GF-4-BE / issue #142).
 */
export class UpdateMilestoneDto {
  @IsInt()
  @Min(0)
  milestone_index: number;

  @IsString()
  @IsIn([...MILESTONE_STATUSES])
  status: MilestoneStatus;

  @IsString()
  actor_wallet: string;

  @IsOptional()
  @IsString()
  evidence_description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence_urls?: string[];
}
