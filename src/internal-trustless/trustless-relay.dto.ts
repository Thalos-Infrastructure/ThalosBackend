import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

export class TrustlessRelayDto {
  @ApiProperty({ enum: ["GET", "POST"] })
  @IsIn(["GET", "POST"])
  method: "GET" | "POST";

  /** Ruta relativa a la base de Trustless Work, ej. deployer/single-release */
  @ApiProperty({ example: "deployer/single-release", maxLength: 512 })
  @IsString()
  @MaxLength(512)
  path: string;

  @ApiPropertyOptional({
    description: "Solo para método GET",
    example: { page: 1, pageSize: 5 },
  })
  @IsOptional()
  @IsObject()
  query?: Record<string, string | number | boolean>;

  @ApiPropertyOptional({ description: "Cuerpo JSON para POST" })
  @IsOptional()
  body?: unknown;
}
