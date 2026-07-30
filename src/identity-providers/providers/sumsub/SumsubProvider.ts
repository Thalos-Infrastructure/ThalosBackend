import { IdentityVerificationProvider, VerificationSession, VerificationStatus, VerificationResult } from '../../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../../abstraction/IdentityConfigManager';
import { SumsubClient } from './SumsubClient';

export class SumsubProvider implements IdentityVerificationProvider {
  private client: SumsubClient;

  constructor(config: unknown) {
    const cm = new IdentityConfigManager(config as Record<string, string>);
    this.client = new SumsubClient(cm.getConfig());
  }

  getProviderName() { return 'sumsub'; }
  validateConfig(config: Record<string, unknown>) { return !!config.apiKey && !!config.apiSecret; }

  async createVerificationSession(data: Record<string, unknown>): Promise<VerificationSession> {
    const externalUserId = String(data.externalUserId || '');
    const { externalUserId: _, ...metadata } = data;
    const applicant = await this.client.createApplicant(externalUserId, metadata) as Record<string, unknown>;
    const accessToken = await this.client.generateAccessToken(String(applicant.externalUserId)) as Record<string, unknown>;
    return { sessionId: String(applicant.externalUserId), applicantId: String(applicant.externalUserId), accessToken, status: 'initiated', provider: 'sumsub' };
  }

  async getVerificationStatus(sessionId: string): Promise<VerificationStatus> {
    const status = await this.client.getApplicantStatus(sessionId) as Record<string, unknown>;
    return { sessionId, status: String(status.reviewStatus || 'pending'), level: status.level, documents: (status.documents as unknown[]) || [], lastUpdated: String(status.updatedAt || '') };
  }

  async retrieveVerificationResult(sessionId: string): Promise<VerificationResult> {
    const data = await this.client.getApplicantData(sessionId) as Record<string, unknown>;
    return { sessionId, result: data, documents: (data.documents as unknown[]) || [], status: String(data.reviewStatus || 'pending') };
  }

  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Sumsub] Verification update received for ${event.externalUserId}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.cancelInspection(sessionId);
  }
}
