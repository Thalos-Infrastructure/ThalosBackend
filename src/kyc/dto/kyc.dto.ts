import { IsOptional, IsString, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateKycSessionDto {
  @ApiPropertyOptional({
    description: 'Optional metadata to attach to the verification session',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class KycWebhookDto {
  @ApiProperty({ description: 'Provider verification ID' })
  @IsString()
  verification_id: string;

  @ApiProperty({ description: 'New verification status' })
  @IsString()
  status: string;
}
