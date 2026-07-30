import { IdentityVerificationProvider, VerificationSession, VerificationStatus, VerificationResult } from '../../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../../abstraction/IdentityConfigManager';
import { VeriffClient } from './VeriffClient';

export class VeriffProvider implements IdentityVerificationProvider {
  private client: VeriffClient;

  constructor(config: unknown) {
    const cm = new IdentityConfigManager(config as Record<string, string>);
    this.client = new VeriffClient(cm.getConfig());
  }

  getProviderName() { return 'veriff'; }
  validateConfig(config: Record<string, unknown>) { return !!config.apiKey && !!config.apiSecret; }

  async createVerificationSession(data: Record<string, unknown>): Promise<VerificationSession> {
    const session = await this.client.createSession({ data: { firstName: data.firstName, lastName: data.lastName, dateOfBirth: data.dob, email: data.email, address: data.address, phoneNumber: data.phone } }) as Record<string, unknown>;
    return { sessionId: String(session.id), status: 'initiated', provider: 'veriff' };
  }

  async getVerificationStatus(sessionId: string): Promise<VerificationStatus> {
    const status = await this.client.getSession(sessionId) as Record<string, unknown>;
    return { sessionId, status: String(status.status || 'pending'), decision: status.decision, lastUpdated: String(status.updatedAt || '') };
  }

  async retrieveVerificationResult(sessionId: string): Promise<VerificationResult> {
    const data = await this.client.getSession(sessionId) as Record<string, unknown>;
    return { sessionId, result: data, status: String(data.status || 'pending') };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Veriff] Verification update for ${event.sessionId}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.getSession(sessionId);
  }
}
