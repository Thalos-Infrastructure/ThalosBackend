import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class CreateKycSessionDto {
  @ApiProperty({
    description: 'Optional metadata to pass to the identity provider',
    example: { campaignId: 'grantfox-august-2026' },
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class KycStatusResponseDto {
  @ApiProperty({
    description: 'The internal verification UUID',
  })
  id: string;

  @ApiProperty({
    description: 'The user UUID',
  })
  userId: string;

  @ApiProperty({
    description: 'Current KYC status',
    enum: ['pending', 'in_review', 'verified', 'rejected', 'expired'],
  })
  status: string;

  @ApiProperty({
    description: 'The identity provider used',
  })
  provider: string;

  @ApiProperty({
    description: 'The session ID from the identity provider',
  })
  providerSessionId: string;

  @ApiProperty({
    description: 'Timestamp when verification was completed',
    required: false,
    nullable: true,
  })
  verifiedAt: string | null;
}
