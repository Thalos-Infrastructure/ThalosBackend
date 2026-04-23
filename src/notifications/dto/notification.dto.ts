import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsNumber,
  Min,
} from "class-validator";

export class NotifyAgreementCreatedDto {
  @IsString()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  asset: string;

  @IsString()
  @IsNotEmpty()
  created_by_wallet: string;

  @IsString()
  @IsOptional()
  created_by_name?: string;

  @IsArray()
  @IsString({ each: true })
  participant_wallets: string[];
}

export class NotifyAgreementFundedDto {
  @IsString()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  asset: string;

  @IsString()
  @IsNotEmpty()
  funded_by_wallet: string;

  @IsString()
  @IsOptional()
  funded_by_name?: string;

  @IsString()
  @IsOptional()
  transaction_signature?: string;
}

export class NotifyEvidenceSubmittedDto {
  @IsString()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  agreement_title: string;

  @IsNumber()
  @Min(0)
  milestone_index: number;

  @IsString()
  @IsNotEmpty()
  milestone_description: string;

  @IsString()
  @IsNotEmpty()
  submitted_by_wallet: string;

  @IsString()
  @IsOptional()
  submitted_by_name?: string;

  @IsString()
  @IsOptional()
  evidence_description?: string;
}

export class NotifyMilestoneApprovedDto {
  @IsString()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  agreement_title: string;

  @IsNumber()
  @Min(0)
  milestone_index: number;

  @IsString()
  @IsNotEmpty()
  milestone_description: string;

  @IsString()
  @IsNotEmpty()
  milestone_amount: string;

  @IsString()
  @IsNotEmpty()
  asset: string;

  @IsString()
  @IsNotEmpty()
  approved_by_wallet: string;

  @IsString()
  @IsOptional()
  approved_by_name?: string;
}

export class NotifyDisputeOpenedDto {
  @IsString()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  agreement_title: string;

  @IsString()
  @IsNotEmpty()
  dispute_reason: string;

  @IsString()
  @IsNotEmpty()
  opened_by_wallet: string;

  @IsString()
  @IsOptional()
  opened_by_name?: string;

  @IsNumber()
  @IsOptional()
  milestone_index?: number;

  @IsString()
  @IsOptional()
  milestone_description?: string;
}

export class NotifyDisputeResolvedDto {
  @IsString()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  agreement_title: string;

  @IsString()
  @IsNotEmpty()
  resolution: string;

  @IsString()
  @IsNotEmpty()
  resolved_by_wallet: string;

  @IsString()
  @IsOptional()
  resolved_by_name?: string;

  @IsString()
  @IsOptional()
  winner_wallet?: string;

  @IsString()
  @IsOptional()
  refund_amount?: string;

  @IsString()
  @IsOptional()
  release_amount?: string;

  @IsString()
  @IsOptional()
  asset?: string;
}

export class NotifyAgreementCompletedDto {
  @IsString()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  total_amount: string;

  @IsString()
  @IsNotEmpty()
  asset: string;

  @IsString()
  @IsNotEmpty()
  completed_at: string;
}

export class SendCustomNotificationDto {
  @IsArray()
  @IsString({ each: true })
  wallets: string[];

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  html: string;
}
