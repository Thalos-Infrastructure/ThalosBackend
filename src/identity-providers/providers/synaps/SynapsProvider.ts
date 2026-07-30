import { IdentityVerificationProvider } from '../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../abstraction/IdentityConfigManager';
import { SynapsClient } from './SynapsClient';

export class SynapsProvider implements IdentityVerificationProvider {
  private configManager: IdentityConfigManager;
  private client: SynapsClient;

  constructor(config: unknown) {
    this.configManager = new IdentityConfigManager(config);
    this.client = new SynapsClient(this.configManager.getConfig());
  }

  getProviderName() {
    return 'synaps';
  }

  validateConfig(config: Record<string, unknown>): boolean {
    return !!config.apiKey;
  }

  async createVerificationSession(data: Record<string, unknown>) {
    const session = await this.client.createSession({
      externalUserId: data.externalUserId,
      type: 'individual',
      metadata: {
        firstName: data.firstName,
        lastName: data.lastName,
        dob: data.dob,
        email: data.email,
        phone: data.phone,
        address: data.address,
      },
    });

    return {
      sessionId: session.id,
      status: 'initiated',
      provider: 'synaps',
    };
  }

  async getVerificationStatus(sessionId: string) {
    const status = await this.client.getSession(sessionId);
    return {
      sessionId,
      status: status.status || 'pending',
      documents: status.documents || [],
      lastUpdated: status.updatedAt,
    };
  }

  async retrieveVerificationResult(sessionId: string) {
    const data = await this.client.getSession(sessionId);
    return {
      sessionId,
      result: data,
      status: data.status || 'pending',
    };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Synaps] Verification update for ${event.sessionId}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.updateSession(sessionId, { status: 'cancelled' });
  }
}