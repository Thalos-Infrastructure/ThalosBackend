import { IsString, IsOptional, IsBoolean, IsIn } from "class-validator";

export type WalletType =
  | "custodial"
  | "freighter"
  | "lobstr"
  | "xbull"
  | "albedo"
  | "other";

export class LinkWalletDto {
  @IsString()
  wallet_address: string;

  @IsString()
  @IsIn(["custodial", "freighter", "lobstr", "xbull", "albedo", "other"])
  wallet_type: WalletType;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  signed_message?: string; // For verification

  @IsOptional()
  @IsString()
  signature?: string; // For verification
}

export class UpdateWalletDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;
}

export class VerifyWalletDto {
  @IsString()
  wallet_address: string;

  @IsString()
  signed_message: string;

  @IsString()
  signature: string;
}
