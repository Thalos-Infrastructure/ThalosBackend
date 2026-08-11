import {
  IKycProvider,
  KycStatus,
  SessionResult,
  VerificationResult,
} from '../interfaces/kyc-provider.interface';
import { IdentityProviderConfig } from '../abstraction/IdentityConfigManager';
import { StripeClient } from './stripe/StripeClient';

export class StripeKycProvider implements IKycProvider {
  readonly name = 'stripe';
  private client: StripeClient;

  constructor(config: IdentityProviderConfig) {
    this.client = new StripeClient(config);
  }

  async createSession(input: {
    userId: string;
    metadata?: Record<string, unknown>;
  }): Promise<SessionResult> {
    const { userId, metadata } = input;
    const session = (await this.client.createVerificationSession({
      metadata: {
        userId,
        ...metadata,
      },
    })) as { id: string; url: string };

    return {
      providerVerificationId: session.id,
      sessionUrl: session.url,
      metadata: { sessionId: session.id },
    };
  }

  async getStatus(providerVerificationId: string): Promise<VerificationResult> {
    const status = (await this.client.retrieveVerificationSession(providerVerificationId)) as {
      status: string;
      created?: string;
    };

    let kycStatus: KycStatus;
    switch (status.status) {
      case 'requires_input':
        kycStatus = KycStatus.PENDING;
        break;
      case 'processing':
        kycStatus = KycStatus.IN_REVIEW;
        break;
      case 'verified':
        kycStatus = KycStatus.VERIFIED;
        break;
      case 'unverified':
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
      verifiedAt: status.created || null,
      metadata: { status: status.status },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async processWebhook(
    payload: unknown,
  ): Promise<{ providerVerificationId: string; result: VerificationResult }> {
    const event = payload as { data: { object: { id: string; status: string } } };

    let kycStatus: KycStatus;
    switch (event.data.object.status) {
      case 'requires_input':
        kycStatus = KycStatus.PENDING;
        break;
      case 'processing':
        kycStatus = KycStatus.IN_REVIEW;
        break;
      case 'verified':
        kycStatus = KycStatus.VERIFIED;
        break;
      case 'unverified':
        kycStatus = KycStatus.REJECTED;
        break;
      case 'expired':
        kycStatus = KycStatus.EXPIRED;
        break;
      default:
        kycStatus = KycStatus.IN_REVIEW;
    }

    return {
      providerVerificationId: event.data.object.id,
      result: {
        status: kycStatus,
        verifiedAt: null,
        metadata: { status: event.data.object.status },
      },
    };
  }
}
