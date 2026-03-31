import { IsIn, IsString } from "class-validator";

export class UpdateAgreementStatusDto {
  @IsString()
  @IsIn([
    "pending",
    "funded",
    "active",
    "completed",
    "disputed",
    "resolved",
    "cancelled",
  ])
  status: string;

  @IsString()
  actor_wallet: string;
}
