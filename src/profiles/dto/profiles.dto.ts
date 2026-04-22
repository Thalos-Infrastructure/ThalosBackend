import { IsString, IsNotEmpty, IsOptional, IsIn } from "class-validator";

export class GetOrCreateProfileDto {
  @IsString()
  @IsNotEmpty()
  wallet_address: string;

  @IsString()
  @IsIn(["personal", "enterprise"])
  @IsOptional()
  account_type?: "personal" | "enterprise";
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
  @IsIn(["personal", "enterprise"])
  @IsOptional()
  account_type?: "personal" | "enterprise";
}

export class SetUserRoleDto {
  @IsString()
  @IsNotEmpty()
  wallet_address: string;

  @IsString()
  @IsIn(["user", "validator", "dispute_resolver", "admin"])
  role: "user" | "validator" | "dispute_resolver" | "admin";
}
