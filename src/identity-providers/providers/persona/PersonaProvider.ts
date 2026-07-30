import {
  IdentityVerificationProvider,
  VerificationSession,
  VerificationStatus,
  VerificationResult,
} from '../../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../../abstraction/IdentityConfigManager';
import { PersonaClient } from './PersonaClient';

export class PersonaProvider implements IdentityVerificationProvider {
  private client: PersonaClient;

  constructor(config: unknown) {
    const cm = new IdentityConfigManager(config as Record<string, string>);
    this.client = new PersonaClient(cm.getConfig());
  }

  getProviderName() {
    return 'persona';
  }
  validateConfig(config: Record<string, unknown>) {
    return !!config.apiKey;
  }

  async createVerificationSession(data: Record<string, unknown>): Promise<VerificationSession> {
    const inquiry = (await this.client.createInquiry({
      type: 'individual',
      attributes: {
        first_name: data.firstName,
        last_name: data.lastName,
        email: data.email,
        dob: data.dob,
        address: data.address,
        phone: data.phone,
      },
    })) as Record<string, unknown>;
    return {
      sessionId: String(inquiry.id),
      inquiryId: String(inquiry.id),
      status: 'initiated',
      provider: 'persona',
    };
  }

  async getVerificationStatus(sessionId: string): Promise<VerificationStatus> {
    const status = (await this.client.getInquiry(sessionId)) as Record<string, unknown>;
    return {
      sessionId,
      status: String(status.status || 'pending'),
      documents: (status.documents as unknown[]) || [],
      lastUpdated: String(status.updatedAt || ''),
    };
  }

  async retrieveVerificationResult(sessionId: string): Promise<VerificationResult> {
    const data = (await this.client.getInquiry(sessionId)) as Record<string, unknown>;
    return { sessionId, result: data, status: String(data.status || 'pending') };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Persona] Verification update received for ${event.inquiryId}`);
    return { success: true };
  }

  async cancelVerification(_sessionId: string) {
    return { success: true, message: 'Persona does not support cancel' };
  }
}
