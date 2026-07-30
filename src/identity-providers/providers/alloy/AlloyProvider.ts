import { IdentityVerificationProvider } from '../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../abstraction/IdentityConfigManager';
import { AlloyClient } from './AlloyClient';

export class AlloyProvider implements IdentityVerificationProvider {
  private configManager: IdentityConfigManager;
  private client: AlloyClient;

  constructor(config: unknown) {
    this.configManager = new IdentityConfigManager(config);
    this.client = new AlloyClient(this.configManager.getConfig());
  }

  getProviderName() {
    return 'alloy';
  }

  validateConfig(config: Record<string, unknown>): boolean {
    return !!config.apiKey;
  }

  async createVerificationSession(data: Record<string, unknown>) {
    const evaluation = await this.client.createEvaluation({
      type: 'individual',
      person: {
        first_name: data.firstName,
        last_name: data.lastName,
        dob: data.dob,
        email: data.email,
        phone_number: data.phone,
      },
      address: {
        street: data.address?.street,
        city: data.address?.city,
        state: data.address?.state,
        zip_code: data.address?.zip,
        country: data.address?.country,
      },
      ...(data.metadata || {}),
    });

    return {
      sessionId: evaluation.id,
      status: 'initiated',
      provider: 'alloy',
    };
  }

  async getVerificationStatus(sessionId: string) {
    const status = await this.client.getEvaluation(sessionId);
    return {
      sessionId,
      status: status.status || 'pending',
      documents: status.documents || [],
      lastUpdated: status.updatedAt,
    };
  }

  async retrieveVerificationResult(sessionId: string) {
    const data = await this.client.getEvaluation(sessionId);
    return {
      sessionId,
      result: data,
      status: data.status || 'pending',
    };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Alloy] Verification update for ${event.evaluationId}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.cancelEvaluation(sessionId);
  }
}