import {
  IdentityVerificationProvider,
  VerificationSession,
  VerificationStatus,
  VerificationResult,
} from '../../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../../abstraction/IdentityConfigManager';
import { SynapsClient } from './SynapsClient';

export class SynapsProvider implements IdentityVerificationProvider {
  private client: SynapsClient;

  constructor(config: unknown) {
    const cm = new IdentityConfigManager(config as Record<string, string>);
    this.client = new SynapsClient(cm.getConfig());
  }

  getProviderName() {
    return 'synaps';
  }
  validateConfig(config: Record<string, unknown>) {
    return !!config.apiKey;
  }

  async createVerificationSession(data: Record<string, unknown>): Promise<VerificationSession> {
    const session = (await this.client.createSession({
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
    })) as Record<string, unknown>;
    return { sessionId: String(session.id), status: 'initiated', provider: 'synaps' };
  }

  async getVerificationStatus(sessionId: string): Promise<VerificationStatus> {
    const status = (await this.client.getSession(sessionId)) as Record<string, unknown>;
    return {
      sessionId,
      status: String(status.status || 'pending'),
      documents: (status.documents as unknown[]) || [],
      lastUpdated: String(status.updatedAt || ''),
    };
  }

  async retrieveVerificationResult(sessionId: string): Promise<VerificationResult> {
    const data = (await this.client.getSession(sessionId)) as Record<string, unknown>;
    return { sessionId, result: data, status: String(data.status || 'pending') };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Synaps] Verification update for ${event.sessionId}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.updateSession(sessionId, { status: 'cancelled' });
  }
}
