import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class CreateKycSessionDto {
  @ApiPropertyOptional({
    description:
      'Optional metadata passed through to the identity provider (e.g. locale, document type).',
    example: { locale: 'en' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
