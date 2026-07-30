import { IdentityVerificationProvider } from '../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../abstraction/IdentityConfigManager';
import { VeriffClient } from './VeriffClient';

export class VeriffProvider implements IdentityVerificationProvider {
  private configManager: IdentityConfigManager;
  private client: VeriffClient;

  constructor(config: unknown) {
    this.configManager = new IdentityConfigManager(config);
    this.client = new VeriffClient(this.configManager.getConfig());
  }

  getProviderName() {
    return 'veriff';
  }

  validateConfig(config: Record<string, unknown>): boolean {
    return !!config.apiKey && !!config.apiSecret;
  }

  async createVerificationSession(data: Record<string, unknown>) {
    const session = await this.client.createSession({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: data.dob,
        email: data.email,
        address: data.address,
        phoneNumber: data.phone,
      },
    });

    return {
      sessionId: session.id,
      status: 'initiated',
      provider: 'veriff',
    };
  }

  async getVerificationStatus(sessionId: string) {
    const status = await this.client.getSession(sessionId);
    return {
      sessionId,
      status: status.status || 'pending',
      decision: status.decision,
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
    console.log(`[Veriff] Verification update for ${event.sessionId}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.getSession(sessionId);
  }
}