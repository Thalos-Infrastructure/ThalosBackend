import { IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class TrustlessRelayDto {
  @IsIn(["GET", "POST"])
  method: "GET" | "POST";

  /** Ruta relativa a la base de Trustless Work, ej. deployer/single-release */
  @IsString()
  @MaxLength(512)
  path: string;

  @IsOptional()
  @IsObject()
  query?: Record<string, string | number | boolean>;

  @IsOptional()
  body?: unknown;
}
