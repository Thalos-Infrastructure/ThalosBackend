import { IsEmail, IsOptional, IsString } from "class-validator";

export class AddContactDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  wallet_address?: string;
}
