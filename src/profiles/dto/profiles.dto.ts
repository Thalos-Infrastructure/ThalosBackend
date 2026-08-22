import { IsBoolean, IsString, IsNotEmpty, IsOptional, IsIn, Matches } from 'class-validator';

export class GetOrCreateProfileDto {
  @IsString()
  @IsNotEmpty()
  wallet_address: string;

  @IsString()
  @IsIn(['personal', 'enterprise'])
  @IsOptional()
  account_type?: 'personal' | 'enterprise';
}

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  display_name?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  avatar_url?: string;

  @IsString()
  @IsIn(['personal', 'enterprise'])
  @IsOptional()
  account_type?: 'personal' | 'enterprise';

  // NOTE: `handle` field is owned by Connect (#159 / migration 009).
  // It will be added to this DTO when that PR merges.
  // Do NOT add handle here to avoid migration/column conflicts.

  @IsBoolean()
  @IsOptional()
  show_earnings?: boolean;
}

export class SetUserRoleDto {
  @IsString()
  @IsNotEmpty()
  wallet_address: string;

  @IsString()
  @IsIn(['user', 'validator', 'dispute_resolver', 'admin'])
  role: 'user' | 'validator' | 'dispute_resolver' | 'admin';
}
