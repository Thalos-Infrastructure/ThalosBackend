import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApplicationDto {
  @ApiProperty({
    description: 'UUID of the opportunity the builder is applying to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  opportunity_id: string;

  @ApiPropertyOptional({
    description: 'Optional cover message from the builder',
    example: 'I have 3 years of experience with Stellar and would love to work on this.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class ListApplicationsQueryDto {
  @ApiProperty({
    description: 'UUID of the opportunity whose applicants to list (owner only)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  opportunity_id: string;
}

export class UpdateApplicationStatusDto {
  @ApiProperty({
    description: 'New status for the application',
    enum: ['accepted', 'rejected'],
    example: 'accepted',
  })
  @IsIn(['accepted', 'rejected'])
  status: 'accepted' | 'rejected';
}
