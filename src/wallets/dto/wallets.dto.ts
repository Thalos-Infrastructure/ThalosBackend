import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  Matches,
  ValidateIf,
  IsDefined,
} from 'class-validator';

export type WalletType =
  'custodial' | 'freighter' | 'lobstr' | 'xbull' | 'albedo' | 'accesly' | 'other';

/** Identity provider behind a custodial wallet. External wallets carry none. */
export type AuthProvider = 'pollar' | 'accesly';

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

  /**
   * Which login produced this wallet (#108 social/email via Pollar, #109 passkey
   * via Accesly). Only meaningful for provisioned wallets — 'custodial' or
   * 'accesly'; an external wallet is connected, not provisioned, so it has no
   * identity provider.
   */
  @IsOptional()
  @IsString()
  @IsIn(['pollar', 'accesly'])
  auth_provider?: AuthProvider;

  /** Pollar user id owning the wallet, when `auth_provider` is 'pollar'. */
  @IsOptional()
  @IsString()
  pollar_user_id?: string;

  /**
   * Smart Account contract address (C…). wallet_address stays the G-address.
   * REQUIRED when wallet_type is 'accesly' — an Accesly identity without its
   * C-address is incomplete.
   */
  @ValidateIf((o: LinkWalletDto) => o.wallet_type === 'accesly' || o.c_address !== undefined)
  @IsDefined({ message: 'c_address is required for accesly wallets' })
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
