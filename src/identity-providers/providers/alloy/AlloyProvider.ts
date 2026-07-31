import {
  IdentityVerificationProvider,
  VerificationSession,
  VerificationStatus,
  VerificationResult,
} from '../../abstraction/IdentityProvider';
import { IdentityConfigManager } from '../../abstraction/IdentityConfigManager';
import { AlloyClient } from './AlloyClient';

export class AlloyProvider implements IdentityVerificationProvider {
  private client: AlloyClient;

  constructor(config: unknown) {
    const cm = new IdentityConfigManager(config as Record<string, string>);
    this.client = new AlloyClient(cm.getConfig());
  }

  getProviderName() {
    return 'alloy';
  }
  validateConfig(config: Record<string, unknown>) {
    return !!config.apiKey;
  }

  async createVerificationSession(data: Record<string, unknown>): Promise<VerificationSession> {
    const addr = (data.address || {}) as Record<string, unknown>;
    const evaluation = (await this.client.createEvaluation({
      type: 'individual',
      person: {
        first_name: data.firstName,
        last_name: data.lastName,
        dob: data.dob,
        email: data.email,
        phone_number: data.phone,
      },
      address: {
        street: addr.street,
        city: addr.city,
        state: addr.state,
        zip_code: addr.zip,
        country: addr.country,
      },
    })) as Record<string, unknown>;
    return { sessionId: String(evaluation.id), status: 'initiated', provider: 'alloy' };
  }

  async getVerificationStatus(sessionId: string): Promise<VerificationStatus> {
    const status = (await this.client.getEvaluation(sessionId)) as Record<string, unknown>;
    return {
      sessionId,
      status: String((status.status as string | undefined) ?? 'pending'),
      documents: (status.documents as unknown[]) || [],
      lastUpdated: String((status.updatedAt as string | undefined) ?? ''),
    };
  }

  async retrieveVerificationResult(sessionId: string): Promise<VerificationResult> {
    const data = (await this.client.getEvaluation(sessionId)) as Record<string, unknown>;
    // prettier-ignore
    return { sessionId, result: data, status: String((data.status as string | undefined) ?? 'pending') };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleVerificationUpdate(event: Record<string, unknown>) {
    console.log(`[Alloy] Verification update for ${String(event.evaluationId)}`);
    return { success: true };
  }

  async cancelVerification(sessionId: string) {
    return await this.client.cancelEvaluation(sessionId);
  }
}
