import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsArray,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OpenDisputeDto {
  @ApiProperty({
    description: 'UUID of the agreement to dispute',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  agreement_id: string;

  @ApiProperty({
    description: 'Wallet address of the user opening the dispute',
    example: 'GABCDEF1234567890',
  })
  @IsString()
  @IsNotEmpty()
  opened_by: string;

  @ApiProperty({
    description: 'Reason for opening the dispute',
    example: 'Deliverable does not match the agreed scope',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    description: 'Optional array of evidence URLs (screenshots, documents, etc.)',
    example: ['https://storage.example.com/evidence/screenshot1.png'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  evidence_urls?: string[];
}

export class AssignResolverDto {
  @ApiProperty({
    description: 'Wallet address of the resolver to assign',
    example: 'GABCDEF1234567890',
  })
  @IsString()
  @IsNotEmpty()
  resolver_wallet: string;
}

export class ResolveDisputeDto {
  @ApiProperty({
    description: 'Wallet address of the user resolving the dispute',
    example: 'GABCDEF1234567890',
  })
  @IsString()
  @IsNotEmpty()
  resolved_by: string;

  @ApiProperty({
    description: 'Percentage of escrow to release to the payer (0-100)',
    example: 60,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  payer_percentage: number;

  @ApiProperty({
    description: 'Percentage of escrow to release to the payee (0-100)',
    example: 40,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  payee_percentage: number;

  @ApiPropertyOptional({
    description: 'Optional notes explaining the resolution decision',
    example: 'Milestone 2 was partially completed; adjusted payout accordingly.',
  })
  @IsString()
  @IsOptional()
  resolution_notes?: string;
}

export class CancelDisputeDto {
  @ApiProperty({
    description: 'Wallet address of the user cancelling the dispute (must match the opener)',
    example: 'GABCDEF1234567890',
  })
  @IsString()
  @IsNotEmpty()
  cancelled_by: string;
}
