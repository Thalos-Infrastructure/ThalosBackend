import { IsIn, IsInt, IsString, Min } from "class-validator";

export class UpdateMilestoneDto {
  @IsInt()
  @Min(0)
  milestone_index: number;

  @IsString()
  @IsIn(["pending", "approved", "released"])
  status: "pending" | "approved" | "released";

  @IsString()
  actor_wallet: string;
}
