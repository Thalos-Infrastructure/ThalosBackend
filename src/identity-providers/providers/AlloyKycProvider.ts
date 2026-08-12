import {
  IKycProvider,
  KycStatus,
  SessionResult,
  VerificationResult,
} from '../interfaces/kyc-provider.interface';
import { IdentityProviderConfig } from '../abstraction/IdentityConfigManager';
import { AlloyClient } from './alloy/AlloyClient';

export class AlloyKycProvider implements IKycProvider {
  readonly name = 'alloy';
  private client: AlloyClient;

  constructor(config: IdentityProviderConfig) {
    this.client = new AlloyClient(config);
  }

  async createSession(input: {
    userId: string;
    metadata?: Record<string, unknown>;
  }): Promise<SessionResult> {
    const { userId, metadata } = input;
    const evaluation = (await this.client.createEvaluation({
      name: 'kyc-verification',
      tags: [`user-${userId}`],
      entity: {
        type: 'individual',
        first_name: metadata?.firstName,
        last_name: metadata?.lastName,
        dob: metadata?.dob,
        email: metadata?.email,
        phone: metadata?.phone,
        address: metadata?.address,
      },
    })) as { evaluation_id: string };

    return {
      providerVerificationId: evaluation.evaluation_id,
      metadata: { evaluationId: evaluation.evaluation_id },
    };
  }

  async getStatus(providerVerificationId: string): Promise<VerificationResult> {
    const evaluation = (await this.client.getEvaluation(providerVerificationId)) as {
      status: string;
      created_at?: string;
    };

    let kycStatus: KycStatus;
    switch (evaluation.status) {
      case 'pending':
        kycStatus = KycStatus.PENDING;
        break;
      case 'running':
        kycStatus = KycStatus.IN_REVIEW;
        break;
      case 'complete':
        kycStatus = KycStatus.VERIFIED;
        break;
      case 'error':
        kycStatus = KycStatus.REJECTED;
        break;
      case 'expired':
        kycStatus = KycStatus.EXPIRED;
        break;
      default:
        kycStatus = KycStatus.IN_REVIEW;
    }

    return {
      status: kycStatus,
      verifiedAt: evaluation.created_at || null,
      metadata: { status: evaluation.status },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async processWebhook(
    payload: unknown,
  ): Promise<{ providerVerificationId: string; result: VerificationResult }> {
    const event = payload as { evaluation_id: string; status: string };

    let kycStatus: KycStatus;
    switch (event.status) {
      case 'pending':
        kycStatus = KycStatus.PENDING;
        break;
      case 'running':
        kycStatus = KycStatus.IN_REVIEW;
        break;
      case 'complete':
        kycStatus = KycStatus.VERIFIED;
        break;
      case 'error':
        kycStatus = KycStatus.REJECTED;
        break;
      case 'expired':
        kycStatus = KycStatus.EXPIRED;
        break;
      default:
        kycStatus = KycStatus.IN_REVIEW;
    }

    return {
      providerVerificationId: event.evaluation_id,
      result: {
        status: kycStatus,
        verifiedAt: null,
        metadata: { status: event.status },
      },
    };
  }
}
