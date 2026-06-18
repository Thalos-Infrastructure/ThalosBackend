import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { InternalSecretGuard } from "./internal-secret.guard";
import { TrustlessRelayDto } from "./trustless-relay.dto";
import { relayToTrustless } from "./trustless-relay.helper";

@ApiTags("internal")
@ApiSecurity("thalos-internal")
@Controller("internal/trustless")
@UseGuards(InternalSecretGuard)
export class InternalTrustlessController {
  @Post("relay")
  @ApiOperation({
    summary: "Relay Trustless Work (interno)",
    description:
      "Solo para servidor Next.js. Header `x-thalos-internal-secret`. Respuesta `{ status, data }`.",
  })
  async relay(@Body() dto: TrustlessRelayDto) {
    return relayToTrustless(dto.method, dto.path, dto.query, dto.body);
  }
}
