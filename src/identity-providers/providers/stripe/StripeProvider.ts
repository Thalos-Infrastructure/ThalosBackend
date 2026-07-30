import { IdentityVerificationProvider, VerificationSession, VerificationStatus, VerificationResult } from '../../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../../abstraction/IdentityConfigManager';
import { StripeClient } from './StripeClient';

export class StripeProvider implements IdentityVerificationProvider {
  private client: StripeClient;

  constructor(config: unknown) {
    const cm = new IdentityConfigManager(config as Record<string, string>);
    this.client = new StripeClient(cm.getConfig());
  }

  getProviderName() { return 'stripe'; }
  validateConfig(config: Record<string, unknown>) { return !!config.apiKey; }

  async createVerificationSession(data: Record<string, unknown>): Promise<VerificationSession> {
    const session = await this.client.createVerificationSession({ metadata: { firstName: data.firstName, lastName: data.lastName, dob: data.dob, email: data.email, address: data.address, phone: data.phone } }) as Record<string, unknown>;
    return { sessionId: String(session.id), status: 'initiated', provider: 'stripe' };
  }

  async getVerificationStatus(sessionId: string): Promise<VerificationStatus> {
    const status = await this.client.retrieveVerificationSession(sessionId) as Record<string, unknown>;
    return { sessionId, status: String(status.status || 'pending'), documents: (status.documents as unknown[]) || [], lastUpdated: String(status.updatedAt || '') };
  }

  async retrieveVerificationResult(sessionId: string): Promise<VerificationResult> {
    const data = await this.client.retrieveVerificationSession(sessionId) as Record<string, unknown>;
    return { sessionId, result: data, status: String(data.status || 'pending') };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    const obj = event.data as Record<string, unknown> | undefined;
    const inner = obj?.object as Record<string, unknown> | undefined;
    console.log(`[Stripe] Verification update for ${inner?.id || 'unknown'}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.cancelVerificationSession(sessionId);
  }
}
