import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { InternalTrustlessService } from "./internal-trustless.service";

@Controller("escrows")
@UseGuards(JwtAuthGuard)
export class EscrowsController {
  constructor(private readonly trustlessService: InternalTrustlessService) {}

  /**
   * GET /escrows/by-signer/:address
   * Get all escrows where the address is a signer
   */
  @Get("by-signer/:address")
  async getEscrowsBySigner(@Param("address") address: string) {
    return this.trustlessService.getEscrowsBySigner(address);
  }

  /**
   * GET /escrows/by-role
   * Get escrows filtered by role, status, and type
   * Query params: address (required), role, status, type
   */
  @Get("by-role")
  async getEscrowsByRole(
    @Query("address") address: string,
    @Query("role") role?: "sender" | "receiver" | "approver",
    @Query("status") status?: string,
    @Query("type") type?: "single-release" | "multi-release",
  ) {
    return this.trustlessService.getEscrowsByRole({
      address,
      role,
      status,
      type,
    });
  }
}
