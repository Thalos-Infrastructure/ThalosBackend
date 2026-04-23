import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsArray,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from "class-validator";

export class OpenDisputeDto {
  @IsUUID()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  opened_by: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  evidence_urls?: string[];
}

export class AssignResolverDto {
  @IsString()
  @IsNotEmpty()
  resolver_wallet: string;
}

export class ResolveDisputeDto {
  @IsString()
  @IsNotEmpty()
  resolved_by: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  payer_percentage: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  payee_percentage: number;

  @IsString()
  @IsOptional()
  resolution_notes?: string;
}

export class CancelDisputeDto {
  @IsString()
  @IsNotEmpty()
  cancelled_by: string;
}
