import { Controller, Post, Get, Param, Body, UseGuards, HttpCode } from '@nestjs/common';
import { IdentityProvidersService } from './identity-providers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WebhookSecretGuard } from './webhook-secret.guard';

@Controller('identity-providers')
export class IdentityProvidersController {
  constructor(private readonly identityProvidersService: IdentityProvidersService) {}

  @Post('session')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async createSession(@Body() body: { userId: string; metadata?: Record<string, unknown> }) {
    return await this.identityProvidersService.createSession(body.userId, body.metadata);
  }

  @Get('status/:id')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Param('id') providerVerificationId: string) {
    return await this.identityProvidersService.getStatus(providerVerificationId);
  }

  @Post('webhook')
  @UseGuards(WebhookSecretGuard)
  async processWebhook(@Body() payload: unknown) {
    return await this.identityProvidersService.processWebhook(payload);
  }
}
