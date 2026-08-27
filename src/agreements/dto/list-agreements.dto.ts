import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { AGREEMENT_STATUSES, type AgreementStatus } from '../agreement-lifecycle';
import { AGREEMENT_TYPES, type AgreementType } from '../agreement-types';

/**
 * `?status=&type=` with blank values is a normal shape for a filter UI that has
 * not picked anything yet, so an empty (or whitespace-only) param means "no
 * filter" rather than "match the empty string". Without this the global
 * ValidationPipe would 400 on `?status=`, since `@IsOptional()` only skips
 * `undefined` and `null`.
 */
const blankToUndefined = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class ListAgreementsQueryDto {
  @ApiPropertyOptional({
    enum: AGREEMENT_STATUSES,
    description: 'Filter by agreement status. Omit or leave blank for every status.',
    example: 'active',
  })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn([...AGREEMENT_STATUSES])
  status?: AgreementStatus;

  @ApiPropertyOptional({
    enum: AGREEMENT_TYPES,
    description: 'Filter by `agreement_type`. Omit or leave blank for every type.',
    example: 'multi',
  })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn([...AGREEMENT_TYPES])
  type?: AgreementType;
}
