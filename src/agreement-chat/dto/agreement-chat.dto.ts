import { IsString, IsNotEmpty, IsUUID } from "class-validator";

export class SendMessageDto {
  @IsUUID()
  @IsNotEmpty()
  agreement_id: string;

  @IsString()
  @IsNotEmpty()
  sender_wallet: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}
