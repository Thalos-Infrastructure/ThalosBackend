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

/** The login that produced or authenticated a wallet. */
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
   * Which login this wallet came through (#108 Pollar, #109 Accesly passkey).
   * Set it when a login provisioned the wallet ('custodial', 'accesly') or, for
   * 'pollar' only, when the user signed in with a wallet they already had and
   * Pollar proved ownership. A wallet connected by its owner in the browser has
   * no identity provider, and passing one for it is rejected.
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
