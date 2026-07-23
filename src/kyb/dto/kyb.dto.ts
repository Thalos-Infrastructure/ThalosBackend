import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const ENTITY_TYPES = ['company', 'startup', 'organization', 'legal_entity'] as const;
const REVIEW_STATUSES = ['in_review', 'verified', 'rejected'] as const;

export class CreateKybSessionDto {
  @ApiProperty({
    description:
      'Stable identifier for the business being verified. If a record already exists for ' +
      'this id, it is reused (or re-verified if it was previously rejected).',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  organization_id: string;

  @ApiProperty({ description: 'Legal / registered name of the business', example: 'Acme Inc.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  business_name: string;

  @ApiProperty({
    description: 'Official business registration / incorporation number',
    example: '20231234567',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  registration_number: string;

  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 country code of incorporation',
    example: 'US',
  })
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an uppercase ISO 3166-1 alpha-2 code' })
  country: string;

  @ApiProperty({
    description: 'Type of legal entity being verified',
    enum: ENTITY_TYPES,
    example: 'company',
  })
  @IsIn(ENTITY_TYPES)
  entity_type: (typeof ENTITY_TYPES)[number];
}

export class ReviewKybSessionDto {
  @ApiProperty({
    description: 'Next status for the verification (admin-only transition)',
    enum: REVIEW_STATUSES,
    example: 'verified',
  })
  @IsIn(REVIEW_STATUSES)
  status: (typeof REVIEW_STATUSES)[number];

  @ApiPropertyOptional({
    description: 'Reason for rejection. Required when status is "rejected".',
    example: 'Registration number does not match public registry records',
  })
  @ValidateIf((o: ReviewKybSessionDto) => o.status === 'rejected')
  @IsString()
  @IsNotEmpty({ message: 'rejection_reason is required when rejecting a verification' })
  @MaxLength(500)
  rejection_reason?: string;
}
