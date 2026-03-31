import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { InternalTrustlessService } from "./internal-trustless.service";
import { TrustlessRelayDto } from "./trustless-relay.dto";

/**
 * Orquestación Trustless con JWT: mismo allowlist que el relay interno.
 * Devuelve la respuesta de TW tal cual (p. ej. { unsignedTransaction } para firmar en cliente).
 */
@Controller("trustless")
@UseGuards(JwtAuthGuard)
export class TrustlessPublicController {
  constructor(private readonly trustless: InternalTrustlessService) {}

  @Post("prepare")
  async prepare(@Body() dto: TrustlessRelayDto) {
    const { status, data } = await this.trustless.relay(
      dto.method,
      dto.path,
      dto.query,
      dto.body,
    );
    return { status, data };
  }
}
