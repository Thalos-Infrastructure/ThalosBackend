import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TrustlessRelayDto } from "./trustless-relay.dto";
import { relayToTrustless } from "./trustless-relay.helper";

@ApiTags("trustless")
@ApiBearerAuth("bearer")
@Controller("trustless")
@UseGuards(JwtAuthGuard)
export class TrustlessPublicController {
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
    return relayToTrustless(dto.method, dto.path, dto.query, dto.body);
  }
}
