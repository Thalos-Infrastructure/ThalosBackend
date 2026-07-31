import {
  IKycProvider,
  KycStatus,
  SessionResult,
  VerificationResult,
} from '../../interfaces/kyc-provider.interface';
import { IdentityProviderConfig } from '../../abstraction/IdentityConfigManager';
import { PersonaClient } from './persona/PersonaClient';

export class PersonaKycProvider implements IKycProvider {
  readonly name = 'persona';
  private client: PersonaClient;

  constructor(config: IdentityProviderConfig) {
    this.client = new PersonaClient(config);
  }

  async createSession(input: {
    userId: string;
    metadata?: Record<string, unknown>;
  }): Promise<SessionResult> {
    const { userId, metadata } = input;
    const inquiry = (await this.client.createInquiry({
      type: 'individual',
      attributes: {
        first_name: metadata?.firstName,
        last_name: metadata?.lastName,
        email: metadata?.email,
        dob: metadata?.dob,
        address: metadata?.address,
        phone: metadata?.phone,
      },
      external_user_id: userId,
    })) as { id: string; url: string };

    return {
      providerVerificationId: inquiry.id,
      sessionUrl: inquiry.url,
      metadata: { inquiryId: inquiry.id },
    };
  }

  async getStatus(providerVerificationId: string): Promise<VerificationResult> {
    const status = (await this.client.getInquiry(providerVerificationId)) as {
      status: string;
      created_at?: string;
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
      verifiedAt: status.created_at || null,
      metadata: { status: status.status },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async processWebhook(
    payload: unknown,
  ): Promise<{ providerVerificationId: string; result: VerificationResult }> {
    const event = payload as { inquiryId: string; status: string };

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
      providerVerificationId: event.inquiryId,
      result: {
        status: kycStatus,
        verifiedAt: null,
        metadata: { status: event.status },
      },
    };
  }
}
