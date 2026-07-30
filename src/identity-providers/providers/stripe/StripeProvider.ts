import { IdentityVerificationProvider } from '../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../abstraction/IdentityConfigManager';
import { StripeClient } from './StripeClient';

export class StripeProvider implements IdentityVerificationProvider {
  private configManager: IdentityConfigManager;
  private client: StripeClient;

  constructor(config: unknown) {
    this.configManager = new IdentityConfigManager(config);
    this.client = new StripeClient(this.configManager.getConfig());
  }

  getProviderName() {
    return 'stripe';
  }

  validateConfig(config: Record<string, unknown>): boolean {
    return !!config.apiKey;
  }

  async createVerificationSession(data: Record<string, unknown>) {
    const session = await this.client.createVerificationSession({
      metadata: {
        firstName: data.firstName,
        lastName: data.lastName,
        dob: data.dob,
        email: data.email,
        address: data.address,
        phone: data.phone,
      },
    });

    return {
      sessionId: session.id,
      status: 'initiated',
      provider: 'stripe',
    };
  }

  async getVerificationStatus(sessionId: string) {
    const status = await this.client.retrieveVerificationSession(sessionId);
    return {
      sessionId,
      status: status.status,
      documents: status.documents || [],
      lastUpdated: status.updatedAt,
    };
  }

  async retrieveVerificationResult(sessionId: string) {
    const data = await this.client.retrieveVerificationSession(sessionId);
    return {
      sessionId,
      result: data,
      status: data.status,
    };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Stripe] Verification update for ${event.data.object.id}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.cancelVerificationSession(sessionId);
  }
}