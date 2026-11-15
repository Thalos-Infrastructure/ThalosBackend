import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  Matches,
} from 'class-validator';

export type WalletType =
  'custodial' | 'freighter' | 'lobstr' | 'xbull' | 'albedo' | 'other';

/** The login that produced or authenticated a wallet. */
export type AuthProvider = 'pollar';

export class LinkWalletDto {
  @IsString()
  wallet_address: string;

  @IsString()
  @IsIn(['custodial', 'freighter', 'lobstr', 'xbull', 'albedo', 'other'])
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
   * Which login this wallet came through (#108 Pollar).
   * Set it when a login provisioned the wallet ('custodial') or when the user
   * signed in with a wallet they already had and Pollar proved ownership.
   * A wallet connected by its owner in the browser has no identity provider,
   * and passing one for it is rejected.
   */
  @IsOptional()
  @IsString()
  @IsIn(['pollar'])
  auth_provider?: AuthProvider;

  /** Pollar user id owning the wallet, when `auth_provider` is 'pollar'. */
  @IsOptional()
  @IsString()
  pollar_user_id?: string;

  /**
   * Optional Soroban contract address (C…). wallet_address stays the G-address.
   */
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
