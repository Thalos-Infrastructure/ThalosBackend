import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from "class-validator";

class MilestoneDto {
  @IsString()
  description: string;

  @IsString()
  amount: string;

  @IsIn(["pending", "approved", "released"])
  status: "pending" | "approved" | "released";
}

class ParticipantDto {
  @IsString()
  wallet_address: string;

  @IsString()
  role: string;

  /** Opcional; si falta se intenta resolver por wallet en profiles */
  @IsOptional()
  @IsUUID()
  profile_id?: string;
}

export class CreateAgreementDto {
  @IsOptional()
  @IsString()
  contract_id?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  amount: string;

  @IsOptional()
  @IsString()
  asset?: string;

  @IsOptional()
  @IsString()
  agreement_type?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MilestoneDto)
  milestones?: MilestoneDto[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsString()
  created_by: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants: ParticipantDto[];
}
