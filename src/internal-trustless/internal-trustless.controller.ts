import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { InternalSecretGuard } from "./internal-secret.guard";
import { InternalTrustlessService } from "./internal-trustless.service";
import { TrustlessRelayDto } from "./trustless-relay.dto";

@Controller("internal/trustless")
@UseGuards(InternalSecretGuard)
export class InternalTrustlessController {
  constructor(private readonly trustless: InternalTrustlessService) {}

  @Post("relay")
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
