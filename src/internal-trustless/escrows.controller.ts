import { BadRequestException, Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { relayToTrustless } from "./trustless-relay.helper";

@Controller("escrows")
@UseGuards(JwtAuthGuard)
export class EscrowsController {
  @Get("by-signer/:address")
  async getEscrowsBySigner(@Param("address") address: string) {
    const result = await relayToTrustless("GET", "helper/get-escrows-by-signer", { address });
    if (result.status >= 400) throw new BadRequestException(result.data);
    return result.data;
  }

  @Get("by-role")
  async getEscrowsByRole(
    @Query("address") address: string,
    @Query("role") role?: "sender" | "receiver" | "approver",
    @Query("status") status?: string,
    @Query("type") type?: "single-release" | "multi-release",
  ) {
    const query: Record<string, string> = { address };
    if (role) query.role = role;
    if (status) query.status = status;
    if (type) query.type = type;
    const result = await relayToTrustless("GET", "helper/get-escrows-by-role", query);
    if (result.status >= 400) throw new BadRequestException(result.data);
    return result.data;
  }
}
