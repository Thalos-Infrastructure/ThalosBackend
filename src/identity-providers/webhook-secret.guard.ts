import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class WebhookSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.KYC_WEBHOOK_SECRET;
    if (!expected) {
      throw new UnauthorizedException('KYC_WEBHOOK_SECRET not configured');
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-kyc-webhook-secret'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value !== expected) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    return true;
  }
}
