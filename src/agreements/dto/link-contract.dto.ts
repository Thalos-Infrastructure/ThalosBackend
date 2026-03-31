import { IsString } from "class-validator";

export class LinkContractDto {
  @IsString()
  contract_id: string;

  @IsString()
  actor_wallet: string;
}
