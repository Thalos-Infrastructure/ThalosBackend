import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsNumber,
  IsObject,
  Min,
  IsBoolean,
} from "class-validator";

export class CreateBountyDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsOptional()
  asset?: string;

  @IsString()
  @IsNotEmpty()
  created_by: string;

  @IsArray()
  @IsString({ each: true })
  validators: string[];

  @IsNumber()
  @Min(1)
  @IsOptional()
  required_validations?: number;

  @IsString()
  @IsOptional()
  deadline?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class LinkContractToBountyDto {
  @IsString()
  @IsNotEmpty()
  contract_id: string;

  @IsString()
  @IsNotEmpty()
  actor_wallet: string;
}

export class SubmitToBountyDto {
  @IsString()
  @IsNotEmpty()
  submitter_wallet: string;

  @IsString()
  @IsNotEmpty()
  submission_url: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ValidateSubmissionDto {
  @IsString()
  @IsNotEmpty()
  validator_wallet: string;

  @IsBoolean()
  approved: boolean;
}

export class UpdateBountyStatusDto {
  @IsString()
  @IsNotEmpty()
  status: string;
}
