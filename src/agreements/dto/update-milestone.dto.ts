import { IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateMilestoneDto {
  @IsInt()
  @Min(0)
  milestone_index: number;

  @IsString()
  @IsIn(['pending', 'approved', 'released', 'rejected'])
  status: 'pending' | 'approved' | 'released' | 'rejected';

  @IsString()
  actor_wallet: string;

  @IsOptional()
  @IsString()
  evidence_description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidence_urls?: string[];
}
