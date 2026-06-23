import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUserCtx } from "../auth/current-user.decorator";
import { SupabaseService } from "../supabase/supabase.service";
import { relayToTrustless } from "./trustless-relay.helper";
import * as escrowWrite from "./escrow-write.helper";
import {
  ApproveMilestoneDto,
  ChangeMilestoneStatusDto,
  CreateEscrowDto,
  DisputeMilestoneDto,
  FundEscrowDto,
  ReleaseFundsDto,
  SendTransactionDto,
} from "./dto/escrow-write.dto";

@ApiTags("escrows")
@ApiBearerAuth("bearer")
@Controller("escrows")
@UseGuards(JwtAuthGuard)
export class EscrowsController {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Verifica que la wallet del firmante coincida con la del usuario autenticado (JWT).
   * Evita que un usuario dispare transacciones a nombre de otra wallet.
   */
  private async assertSignerWallet(
    userId: string,
    signer: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from("auth_users")
      .select("wallet_public_key")
      .eq("id", userId)
      .maybeSingle();

    const wallet = data?.wallet_public_key as string | undefined;
    if (error || !wallet) {
      throw new ForbiddenException(
        "No hay wallet en auth_users para este usuario (wallet_public_key vacío o usuario no encontrado).",
      );
    }
    if (wallet !== signer) {
      throw new ForbiddenException(
        "El firmante debe ser exactamente la wallet del usuario del JWT (auth_users.wallet_public_key).",
      );
    }
  }

  @Get("by-signer/:address")
  async getEscrowsBySigner(@Param("address") address: string) {
    const result = await relayToTrustless("GET", "helper/get-escrows-by-signer", { address });
    if (result.status >= 400) throw new BadRequestException(result.data);
    return result.data;
  }

  @Get('by-role')
  async getEscrowsByRole(
    @Query('address') address: string,
    @Query('role') role?: 'sender' | 'receiver' | 'approver',
    @Query('status') status?: string,
    @Query('type') type?: 'single-release' | 'multi-release',
  ) {
    const query: Record<string, string> = { address };
    if (role) query.role = role;
    if (status) query.status = status;
    if (type) query.type = type;
    const result = await relayToTrustless('GET', 'helper/get-escrows-by-role', query);
    if (result.status >= 400) throw new BadRequestException(result.data);
    return result.data;
  }

  /**
   * POST /escrows/create
   * Deploy un nuevo escrow (single o multi release). Devuelve { unsignedTransaction }.
   */
  @Post("create")
  @HttpCode(200)
  @ApiOperation({ summary: "Crear escrow (devuelve XDR sin firmar)" })
  async createEscrow(
    @CurrentUser() user: AuthUserCtx,
    @Body() dto: CreateEscrowDto,
  ) {
    await this.assertSignerWallet(user.userId, dto.signer);
    return escrowWrite.createEscrow(dto);
  }

  /**
   * POST /escrows/fund
   * Fondear un escrow. Devuelve { unsignedTransaction }.
   */
  @Post("fund")
  @HttpCode(200)
  @ApiOperation({ summary: "Fondear escrow (devuelve XDR sin firmar)" })
  async fundEscrow(
    @CurrentUser() user: AuthUserCtx,
    @Body() dto: FundEscrowDto,
  ) {
    await this.assertSignerWallet(user.userId, dto.signer);
    return escrowWrite.fundEscrow(dto);
  }

  /**
   * POST /escrows/approve-milestone
   * Aprobar un milestone. Devuelve { unsignedTransaction }.
   */
  @Post("approve-milestone")
  @HttpCode(200)
  @ApiOperation({ summary: "Aprobar milestone (devuelve XDR sin firmar)" })
  async approveMilestone(
    @CurrentUser() user: AuthUserCtx,
    @Body() dto: ApproveMilestoneDto,
  ) {
    await this.assertSignerWallet(user.userId, dto.approver);
    return escrowWrite.approveMilestone(dto);
  }

  /**
   * POST /escrows/change-milestone-status
   * Cambiar el estado de un milestone (evidencia + status). Devuelve { unsignedTransaction }.
   */
  @Post("change-milestone-status")
  @HttpCode(200)
  @ApiOperation({ summary: "Cambiar estado de milestone (devuelve XDR sin firmar)" })
  async changeMilestoneStatus(
    @CurrentUser() user: AuthUserCtx,
    @Body() dto: ChangeMilestoneStatusDto,
  ) {
    await this.assertSignerWallet(user.userId, dto.serviceProvider);
    return escrowWrite.changeMilestoneStatus(dto);
  }

  /**
   * POST /escrows/release
   * Liberar fondos (single: todo; multi: por milestone). Devuelve { unsignedTransaction }.
   */
  @Post("release")
  @HttpCode(200)
  @ApiOperation({ summary: "Liberar fondos (devuelve XDR sin firmar)" })
  async releaseFunds(
    @CurrentUser() user: AuthUserCtx,
    @Body() dto: ReleaseFundsDto,
  ) {
    await this.assertSignerWallet(user.userId, dto.releaseSigner);
    return escrowWrite.releaseFunds(dto);
  }

  /**
   * POST /escrows/dispute
   * Abrir disputa sobre un milestone. Devuelve { unsignedTransaction }.
   */
  @Post("dispute")
  @HttpCode(200)
  @ApiOperation({ summary: "Disputar milestone (devuelve XDR sin firmar)" })
  async disputeMilestone(
    @CurrentUser() user: AuthUserCtx,
    @Body() dto: DisputeMilestoneDto,
  ) {
    await this.assertSignerWallet(user.userId, dto.signer);
    return escrowWrite.disputeMilestone(dto);
  }

  /**
   * POST /escrows/send-transaction
   * Enviar a la red el XDR ya firmado en el cliente.
   */
  @Post("send-transaction")
  @HttpCode(200)
  @ApiOperation({ summary: "Enviar transacción firmada (XDR)" })
  async sendTransaction(@Body() dto: SendTransactionDto) {
    return escrowWrite.sendTransaction(dto);
  }
}
