import { IdentityVerificationProvider } from '../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../abstraction/IdentityConfigManager';
import { SumsubClient } from './SumsubClient';

export class SumsubProvider implements IdentityVerificationProvider {
  private configManager: IdentityConfigManager;
  private client: SumsubClient;

  constructor(config: unknown) {
    this.configManager = new IdentityConfigManager(config);
    this.client = new SumsubClient(this.configManager.getConfig());
  }

  getProviderName() {
    return 'sumsub';
  }

  validateConfig(config: Record<string, unknown>): boolean {
    return !!config.apiKey && !!config.apiSecret;
  }

  async createVerificationSession(data: Record<string, unknown>) {
    const { externalUserId, ...metadata } = data;

    const applicant = await this.client.createApplicant(externalUserId, metadata);
    const accessToken = await this.client.generateAccessToken(applicant.externalUserId);

    return {
      sessionId: applicant.externalUserId,
      applicantId: applicant.externalUserId,
      accessToken,
      status: 'initiated',
      provider: 'sumsub',
    };
  }

  async getVerificationStatus(sessionId: string) {
    const status = await this.client.getApplicantStatus(sessionId);
    return {
      sessionId,
      status: status.reviewStatus || 'pending',
      level: status.level,
      documents: status.documents || [],
      lastUpdated: status.updatedAt,
    };
  }

  async retrieveVerificationResult(sessionId: string) {
    const data = await this.client.getApplicantData(sessionId);
    return {
      sessionId,
      result: data,
      documents: data.documents || [],
      status: data.reviewStatus || 'pending',
    };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Sumsub] Verification update received for ${event.externalUserId}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.cancelInspection(sessionId);
  }
}