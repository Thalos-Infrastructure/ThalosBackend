import { IsString, IsOptional, IsBoolean, IsIn, Matches } from 'class-validator';

export type WalletType =
  | 'custodial'
  | 'freighter'
  | 'lobstr'
  | 'xbull'
  | 'albedo'
  | 'accesly'
  | 'other';

export class LinkWalletDto {
  @IsString()
  wallet_address: string;

  @IsString()
  @IsIn(['custodial', 'freighter', 'lobstr', 'xbull', 'albedo', 'accesly', 'other'])
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

  /** Login method that produced this wallet ('accesly', 'pollar', …). #108/#109 */
  @IsOptional()
  @IsString()
  auth_provider?: string;

  /** Smart Account contract address (C…). wallet_address stays the G-address. */
  @IsOptional()
  @Matches(/^C[A-Z2-7]{55}$/, { message: 'c_address must be a Soroban contract address (C…)' })
  c_address?: string;
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
