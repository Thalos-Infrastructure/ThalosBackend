import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** URL-safe slug: lowercase, digits, single dashes between segments. */
export const HANDLE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const AVAILABILITY_VALUES = ['available', 'open', 'unavailable'] as const;
export type Availability = (typeof AVAILABILITY_VALUES)[number];

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

  // ---- Builder fields ----
  @IsString()
  @IsOptional()
  headline?: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  skills?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tech_stack?: string[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  hourly_rate?: number;

  @IsIn(AVAILABILITY_VALUES)
  @IsOptional()
  availability?: Availability;

  @IsOptional()
  portfolio_links?: unknown;

  @IsObject()
  @IsOptional()
  social_links?: Record<string, unknown>;

  @IsString()
  @Length(3, 32)
  @Matches(HANDLE_REGEX, {
    message: 'handle must be a URL-safe slug: lowercase letters, digits and single dashes',
  })
  @IsOptional()
  handle?: string;

  // ---- Project fields ----
  @IsString()
  @IsOptional()
  org_name?: string;

  @IsString()
  @IsOptional()
  org_description?: string;

  @IsString()
  @IsOptional()
  org_website?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  looking_for?: string[];

  @IsObject()
  @IsOptional()
  org_links?: Record<string, unknown>;

  // ---- Reputation fields (issue #147) ----
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

/** Query params for the Connect discovery directory (Builders tab). */
export class DiscoverProfilesDto {
  /** Comma-separated list; matches profiles having ANY of these skills. */
  @IsString()
  @IsOptional()
  skills?: string;

  /** Comma-separated list; matches profiles having ANY of these techs. */
  @IsString()
  @IsOptional()
  tech_stack?: string;

  @IsIn(AVAILABILITY_VALUES)
  @IsOptional()
  availability?: Availability;

  /** Free-text search over headline/bio. */
  @IsString()
  @IsOptional()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 12;
}
