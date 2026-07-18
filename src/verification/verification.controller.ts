import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { VerificationService } from './verification.service';
import { WalletsService } from '../wallets/wallets.service';
import {
  CreateVerificationSessionDto,
  VerificationProvider,
  VerificationType,
  type ProviderWebhookPayload,
} from './dto/verification.dto';

@ApiTags('verification')
@ApiBearerAuth('bearer')
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly verificationService: VerificationService,
    private readonly walletsService: WalletsService,
  ) {}

  @Post('sessions')
  @UseGuards(JwtAuthGuard)
  async createSession(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateVerificationSessionDto) {
    // Get the user's primary wallet address
    const primaryWallet = await this.walletsService.getPrimaryWallet(user.userId);
    if (!primaryWallet) {
      throw new BadRequestException('No wallet found for user');
    }

    const result = await this.verificationService.createSession(
      user.userId,
      primaryWallet.wallet_address,
      dto,
    );

    if (result.error) {
      throw new BadRequestException(result.error);
    }

    return { session: result.session, error: null };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async getSessions(
    @CurrentUser() user: AuthUserCtx,
    @Param() _params: { type?: VerificationType },
  ) {
    const type = _params?.type;
    const result = await this.verificationService.getSessionsByUser(user.userId, type);

    return { sessions: result.sessions, error: result.error };
  }

  @Get('sessions/:id')
  @UseGuards(JwtAuthGuard)
  async getSession(@CurrentUser() user: AuthUserCtx, @Param('id') sessionId: string) {
    const result = await this.verificationService.getSession(user.userId, sessionId);

    if (result.error) {
      throw new BadRequestException(result.error);
    }

    return { session: result.session, error: null };
  }

  @Get('sessions/:id/results')
  @UseGuards(JwtAuthGuard)
  async getResults(@CurrentUser() user: AuthUserCtx, @Param('id') sessionId: string) {
    const result = await this.verificationService.getResults(user.userId, sessionId);

    if (result.error) {
      throw new BadRequestException(result.error);
    }

    return { session: result.session, error: null };
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  async cancelSession(@CurrentUser() user: AuthUserCtx, @Param('id') sessionId: string) {
    const result = await this.verificationService.cancelSession(user.userId, sessionId);

    if (result.error) {
      throw new BadRequestException(result.error);
    }

    return { session: result.session, error: null };
  }

  @Post('webhooks/:provider')
  async handleWebhook(
    @Param('provider') provider: VerificationProvider,
    @Body() payload: ProviderWebhookPayload,
  ) {
    const result = await this.verificationService.handleWebhook(provider, payload);

    if (result.error) {
      throw new BadRequestException(result.error);
    }

    return { handled: result.handled, error: null };
  }

  @Get('providers')
  getProviders() {
    const providers = this.verificationService.getSupportedProviders();
    return { providers, error: null };
  }
}
