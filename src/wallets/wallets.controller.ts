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
import { CurrentUser, JwtPayload } from "../auth/current-user.decorator";
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
  async getMyWallets(@CurrentUser() user: JwtPayload) {
    return this.walletsService.getUserWallets(user.sub);
  }

  /**
   * GET /wallets/with-balances
   * Get all wallets with their current balances
   */
  @Get("with-balances")
  async getMyWalletsWithBalances(@CurrentUser() user: JwtPayload) {
    return this.walletsService.getUserWalletsWithBalances(user.sub);
  }

  /**
   * GET /wallets/agreements
   * Get all agreements grouped by wallet
   */
  @Get("agreements")
  async getAgreementsByWallet(@CurrentUser() user: JwtPayload) {
    return this.walletsService.getAgreementsByWallet(user.sub);
  }

  /**
   * GET /wallets/primary
   * Get the primary wallet for the user
   */
  @Get("primary")
  async getPrimaryWallet(@CurrentUser() user: JwtPayload) {
    const wallet = await this.walletsService.getPrimaryWallet(user.sub);
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
    @CurrentUser() user: JwtPayload,
    @Body() dto: LinkWalletDto,
  ) {
    return this.walletsService.linkWallet(user.sub, dto);
  }

  /**
   * PATCH /wallets/:id
   * Update a wallet (label, primary status)
   */
  @Patch(":id")
  async updateWallet(
    @CurrentUser() user: JwtPayload,
    @Param("id") walletId: string,
    @Body() dto: UpdateWalletDto,
  ) {
    return this.walletsService.updateWallet(user.sub, walletId, dto);
  }

  /**
   * DELETE /wallets/:id
   * Unlink a wallet from the user account
   */
  @Delete(":id")
  async unlinkWallet(
    @CurrentUser() user: JwtPayload,
    @Param("id") walletId: string,
  ) {
    return this.walletsService.unlinkWallet(user.sub, walletId);
  }

  /**
   * GET /wallets/check/:address
   * Check if a wallet belongs to the authenticated user
   */
  @Get("check/:address")
  async checkWalletOwnership(
    @CurrentUser() user: JwtPayload,
    @Param("address") address: string,
  ) {
    const belongs = await this.walletsService.walletBelongsToUser(
      user.sub,
      address,
    );
    return { belongs };
  }
}
