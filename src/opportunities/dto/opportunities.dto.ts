import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ENGAGEMENT_TYPES,
  OPPORTUNITY_STATUSES,
  type EngagementType,
  type OpportunityStatus,
} from '../opportunity.types';

function splitCsv(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return value;
}

export class CreateOpportunityDto {
  @ApiPropertyOptional({
    description: 'Owning Project profile id. If omitted, taken from the authenticated profile.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiProperty({ example: 'Soroban contract reviewer' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'Review a single-release escrow contract and file findings.' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(4000)
  description: string;

  @ApiProperty({ type: [String], example: ['rust', 'soroban'] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  skills_required: string[];

  @ApiProperty({ example: 1500, minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  budget_amount: number;

  @ApiPropertyOptional({ example: 'USDC', default: 'USDC' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  budget_asset?: string;

  @ApiProperty({ enum: ENGAGEMENT_TYPES, example: 'fixed' })
  @IsIn(ENGAGEMENT_TYPES)
  engagement_type: EngagementType;
}

export class UpdateOpportunityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(40, { each: true })
  skills_required?: string[];

  @ApiPropertyOptional({ minimum: 0.01 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @IsPositive()
  budget_amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  budget_asset?: string;

  @ApiPropertyOptional({ enum: ENGAGEMENT_TYPES })
  @IsOptional()
  @IsIn(ENGAGEMENT_TYPES)
  engagement_type?: EngagementType;

  @ApiPropertyOptional({
    enum: OPPORTUNITY_STATUSES,
    description: 'Only open → closed and open → filled are allowed.',
  })
  @IsOptional()
  @IsIn(OPPORTUNITY_STATUSES)
  status?: OpportunityStatus;
}

export class DiscoverOpportunitiesQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated or repeated skills. Matches any overlap with skills_required.',
    example: 'rust,soroban',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => splitCsv(value))
  @IsArray()
  @IsString({ each: true })
  skills_required?: string[];

  @ApiPropertyOptional({ enum: ENGAGEMENT_TYPES })
  @IsOptional()
  @IsIn(ENGAGEMENT_TYPES)
  engagement_type?: EngagementType;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budget_min?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  budget_max?: number;

  @ApiPropertyOptional({ description: 'Case-insensitive search on title and description' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
