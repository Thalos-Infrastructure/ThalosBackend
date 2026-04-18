import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, AuthUserCtx } from "../auth/current-user.decorator";
import { WalletsService } from "./wallets.service";
import { LinkWalletDto, UpdateWalletDto } from "./dto/wallets.dto";

@Controller("wallets")
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  /**
   * GET /wallets
   * Get all wallets for the authenticated user
   */
  @Get()
  async getMyWallets(@CurrentUser() user: AuthUserCtx) {
    return this.walletsService.getUserWallets(user.userId);
  }

  /**
   * GET /wallets/with-balances
   * Get all wallets with their current balances
   */
  @Get("with-balances")
  async getMyWalletsWithBalances(@CurrentUser() user: AuthUserCtx) {
    return this.walletsService.getUserWalletsWithBalances(user.userId);
  }

  /**
   * GET /wallets/agreements
   * Get all agreements grouped by wallet
   */
  @Get("agreements")
  async getAgreementsByWallet(@CurrentUser() user: AuthUserCtx) {
    return this.walletsService.getAgreementsByWallet(user.userId);
  }

  /**
   * GET /wallets/primary
   * Get the primary wallet for the user
   */
  @Get("primary")
  async getPrimaryWallet(@CurrentUser() user: AuthUserCtx) {
    const wallet = await this.walletsService.getPrimaryWallet(user.userId);
    return { wallet };
  }

  /**
   * GET /wallets/:address/balance
   * Get balance for a specific wallet address
   */
  @Get(":address/balance")
  async getWalletBalance(@Param("address") address: string) {
    const balance = await this.walletsService.getWalletBalance(address);
    return { balance };
  }

  /**
   * POST /wallets
   * Link a new wallet to the user account
   */
  @Post()
  async linkWallet(
    @CurrentUser() user: AuthUserCtx,
    @Body() dto: LinkWalletDto,
  ) {
    return this.walletsService.linkWallet(user.userId, dto);
  }

  /**
   * PATCH /wallets/:id
   * Update a wallet (label, primary status)
   */
  @Patch(":id")
  async updateWallet(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") walletId: string,
    @Body() dto: UpdateWalletDto,
  ) {
    return this.walletsService.updateWallet(user.userId, walletId, dto);
  }

  /**
   * DELETE /wallets/:id
   * Unlink a wallet from the user account
   */
  @Delete(":id")
  async unlinkWallet(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") walletId: string,
  ) {
    return this.walletsService.unlinkWallet(user.userId, walletId);
  }

  /**
   * GET /wallets/check/:address
   * Check if a wallet belongs to the authenticated user
   */
  @Get("check/:address")
  async checkWalletOwnership(
    @CurrentUser() user: AuthUserCtx,
    @Param("address") address: string,
  ) {
    const belongs = await this.walletsService.walletBelongsToUser(
      user.userId,
      address,
    );
    return { belongs };
  }
}
