import { Injectable, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IKycProvider, KYC_PROVIDER } from './interfaces/kyc-provider.interface';

@Injectable()
export class IdentityProvidersService {
  constructor(
    @Inject(KYC_PROVIDER) private readonly provider: IKycProvider,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createSession(userId: string, metadata?: Record<string, unknown>) {
    return await this.provider.createSession({ userId, metadata });
  }

  async getStatus(providerVerificationId: string) {
    return await this.provider.getStatus(providerVerificationId);
  }

  async processWebhook(payload: unknown) {
    const result = await this.provider.processWebhook(payload);

    // Emit event so the KycModule can automatically update the verification status
    this.eventEmitter.emit('kyc.webhook.processed', result);

    return result;
  }
}
