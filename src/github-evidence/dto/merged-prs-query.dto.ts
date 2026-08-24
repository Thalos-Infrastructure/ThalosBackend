import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MergedPrsQueryDto {
  @ApiProperty({
    description: 'GitHub repository in owner/repo format',
    example: 'stellar/stellar-core',
  })
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/, {
    message: 'repo must be in owner/repo format (e.g. stellar/stellar-core)',
  })
  repo: string;
}
