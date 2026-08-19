import { IsInt, IsString, IsDateString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AttachPrDto {
  @ApiProperty({
    description: 'GitHub repository in owner/repo format',
    example: 'stellar/stellar-core',
  })
  @IsString()
  repo: string;

  @ApiProperty({ description: 'Pull request number', example: 42 })
  @IsInt()
  @Min(1)
  pr_number: number;

  @ApiProperty({ description: 'Pull request title', example: 'feat: add escrow release' })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Full URL to the pull request',
    example: 'https://github.com/stellar/stellar-core/pull/42',
  })
  @IsString()
  url: string;

  @ApiProperty({
    description: 'ISO 8601 timestamp when the PR was merged',
    example: '2026-08-01T12:00:00Z',
  })
  @IsDateString()
  merged_at: string;

  @ApiProperty({ description: 'Wallet address of the user attaching the PR' })
  @IsString()
  actor_wallet: string;
}
