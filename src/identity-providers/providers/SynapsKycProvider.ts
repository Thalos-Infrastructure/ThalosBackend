import {
  IKycProvider,
  KycStatus,
  SessionResult,
  VerificationResult,
} from '../../interfaces/kyc-provider.interface';
import { IdentityProviderConfig } from '../../abstraction/IdentityConfigManager';
import { SynapsClient } from './synaps/SynapsClient';

export class SynapsKycProvider implements IKycProvider {
  readonly name = 'synaps';
  private client: SynapsClient;

  constructor(config: IdentityProviderConfig) {
    this.client = new SynapsClient(config);
  }

  async createSession(input: {
    userId: string;
    metadata?: Record<string, unknown>;
  }): Promise<SessionResult> {
    const { userId, metadata } = input;
    const session = (await this.client.createSession({
      externalUserId: userId,
      type: 'individual',
      metadata: {
        firstName: metadata?.firstName,
        lastName: metadata?.lastName,
        dob: metadata?.dob,
        email: metadata?.email,
        phone: metadata?.phone,
        address: metadata?.address,
      },
    })) as { id: string; session_url: string };

    return {
      providerVerificationId: session.id,
      sessionUrl: session.session_url,
      metadata: { sessionId: session.id },
    };
  }

  async getStatus(providerVerificationId: string): Promise<VerificationResult> {
    const status = (await this.client.getSession(providerVerificationId)) as {
      status: string;
      updated_at?: string;
    };

    let kycStatus: KycStatus;
    switch (status.status) {
      case 'pending':
        kycStatus = KycStatus.PENDING;
        break;
      case 'in_review':
        kycStatus = KycStatus.IN_REVIEW;
        break;
      case 'approved':
        kycStatus = KycStatus.VERIFIED;
        break;
      case 'rejected':
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
      verifiedAt: status.updated_at || null,
      metadata: { status: status.status },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async processWebhook(
    payload: unknown,
  ): Promise<{ providerVerificationId: string; result: VerificationResult }> {
    const event = payload as { sessionId: string; status: string };

    let kycStatus: KycStatus;
    switch (event.status) {
      case 'pending':
        kycStatus = KycStatus.PENDING;
        break;
      case 'in_review':
        kycStatus = KycStatus.IN_REVIEW;
        break;
      case 'approved':
        kycStatus = KycStatus.VERIFIED;
        break;
      case 'rejected':
        kycStatus = KycStatus.REJECTED;
        break;
      case 'expired':
        kycStatus = KycStatus.EXPIRED;
        break;
      default:
        kycStatus = KycStatus.IN_REVIEW;
    }

    return {
      providerVerificationId: event.sessionId,
      result: {
        status: kycStatus,
        verifiedAt: null,
        metadata: { status: event.status },
      },
    };
  }
}
