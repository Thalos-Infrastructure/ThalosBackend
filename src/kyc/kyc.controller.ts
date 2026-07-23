import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUserCtx } from '../auth/current-user.decorator';
import { KycService } from './kyc.service';
import { CreateKycSessionDto, KycWebhookDto } from './dto/kyc.dto';

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

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
  @ApiOperation({ summary: 'Get KYC verification status for a user' })
  @ApiResponse({ status: 200, description: 'KYC status retrieved' })
  async getStatus(@Param('userId') userId: string) {
    return this.kycService.getStatus(userId);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Receive KYC verification results from provider' })
  @ApiResponse({ status: 201, description: 'Webhook processed' })
  async handleWebhook(@Body() dto: KycWebhookDto) {
    return this.kycService.handleWebhook(dto);
  }
}
