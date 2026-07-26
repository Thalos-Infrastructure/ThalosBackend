import { Body, Controller, Get, Headers, HttpCode, Param, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUserCtx } from '../auth/current-user.decorator';
import { KycService } from './kyc.service';
import { CreateKycSessionDto, KycWebhookDto } from './dto/kyc.dto';

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(
    private readonly kycService: KycService,
    private readonly config: ConfigService,
  ) {}

  @Post('session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Create a new KYC verification session' })
  @ApiResponse({ status: 201, description: 'KYC session created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createSession(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateKycSessionDto) {
    return this.kycService.createSession(user.userId, dto.metadata);
  }

  @Get('status/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get KYC verification status for a user' })
  @ApiResponse({ status: 200, description: 'KYC status retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — you can only view your own KYC status' })
  async getStatus(@CurrentUser() user: AuthUserCtx, @Param('userId') userId: string) {
    return this.kycService.getStatus(userId, user.userId);
  }

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive KYC verification results from provider' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 401, description: 'Invalid or missing webhook secret' })
  async handleWebhook(
    @Body() dto: KycWebhookDto,
    @Headers('x-kyc-webhook-secret') webhookSecret: string,
  ) {
    const expected = this.config.get<string>('KYC_WEBHOOK_SECRET');
    if (!expected || !webhookSecret || webhookSecret !== expected) {
      throw new UnauthorizedException('Invalid or missing KYC webhook secret');
    }
    return this.kycService.handleWebhook(dto);
  }
}
