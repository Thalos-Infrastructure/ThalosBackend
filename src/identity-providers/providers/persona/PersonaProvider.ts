import { IdentityVerificationProvider } from '../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../abstraction/IdentityConfigManager';
import { PersonaClient } from './PersonaClient';

export class PersonaProvider implements IdentityVerificationProvider {
  private configManager: IdentityConfigManager;
  private client: PersonaClient;

  constructor(config: unknown) {
    this.configManager = new IdentityConfigManager(config);
    this.client = new PersonaClient(this.configManager.getConfig());
  }

  getProviderName() {
    return 'persona';
  }

  validateConfig(config: Record<string, unknown>): boolean {
    return !!config.apiKey;
  }

  async createVerificationSession(data: Record<string, unknown>) {
    const inquiry = await this.client.createInquiry({
      data: {
        type: 'individual',
        attributes: {
          first_name: data.firstName,
          last_name: data.lastName,
          email: data.email,
          dob: data.dob,
          address: data.address,
          phone: data.phone,
        },
      },
    });

    return {
      sessionId: inquiry.id,
      inquiryId: inquiry.id,
      status: 'initiated',
      provider: 'persona',
    };
  }

  async getVerificationStatus(sessionId: string) {
    const status = await this.client.getInquiry(sessionId);
    return {
      sessionId,
      status: status.status || 'pending',
      documents: status.documents || [],
      lastUpdated: status.updatedAt,
    };
  }

  async retrieveVerificationResult(sessionId: string) {
    const data = await this.client.getInquiry(sessionId);
    return {
      sessionId,
      result: data,
      status: data.status || 'pending',
    };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Persona] Verification update received for ${event.inquiryId}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return { success: true, message: 'Persona does not support cancel' };
  }
}