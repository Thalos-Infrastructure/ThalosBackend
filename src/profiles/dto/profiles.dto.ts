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

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,30}$/, {
    message: 'handle must be 2-31 chars: lowercase alphanumeric, hyphens, underscores',
  })
  handle?: string;

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
