import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { InternalTrustlessService } from "./internal-trustless.service";
import { TrustlessRelayDto } from "./trustless-relay.dto";

/**
 * Orquestación Trustless con JWT: mismo allowlist que el relay interno.
 * Devuelve la respuesta de TW tal cual (p. ej. { unsignedTransaction } para firmar en cliente).
 */
@ApiTags("trustless")
@ApiBearerAuth("bearer")
@Controller("trustless")
@UseGuards(JwtAuthGuard)
export class TrustlessPublicController {
  constructor(private readonly trustless: InternalTrustlessService) {}

  @Post("prepare")
  @ApiOperation({
    summary: "Proxy Trustless Work (JWT)",
    description:
      "Misma semántica que el relay interno; requiere Bearer. Respuesta `{ status, data }` (upstream de TW).",
  })
  async prepare(@Body() dto: TrustlessRelayDto): Promise<{
    status: number;
    data: unknown;
  }> {
    const { status, data } = await this.trustless.relay(
      dto.method,
      dto.path,
      dto.query,
      dto.body,
    );
    return { status, data };
  }
}
