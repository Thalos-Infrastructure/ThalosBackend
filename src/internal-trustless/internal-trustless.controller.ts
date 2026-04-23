import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { InternalSecretGuard } from "./internal-secret.guard";
import { InternalTrustlessService } from "./internal-trustless.service";
import { TrustlessRelayDto } from "./trustless-relay.dto";

@ApiTags("internal")
@ApiSecurity("thalos-internal")
@Controller("internal/trustless")
@UseGuards(InternalSecretGuard)
export class InternalTrustlessController {
  constructor(private readonly trustless: InternalTrustlessService) {}

  @Post("relay")
  @ApiOperation({
    summary: "Relay Trustless Work (interno)",
    description:
      "Solo para servidor Next.js. Header `x-thalos-internal-secret`. Respuesta `{ status, data }`.",
  })
  async relay(@Body() dto: TrustlessRelayDto) {
    const { status, data } = await this.trustless.relay(
      dto.method,
      dto.path,
      dto.query,
      dto.body,
    );
    return { status, data };
  }
}
