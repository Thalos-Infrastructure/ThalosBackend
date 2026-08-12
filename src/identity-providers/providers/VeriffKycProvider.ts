import {
  IKycProvider,
  KycStatus,
  SessionResult,
  VerificationResult,
} from '../interfaces/kyc-provider.interface';
import { IdentityProviderConfig } from '../abstraction/IdentityConfigManager';
import { VeriffClient } from './veriff/VeriffClient';

export class VeriffKycProvider implements IKycProvider {
  readonly name = 'veriff';
  private client: VeriffClient;

  constructor(config: IdentityProviderConfig) {
    this.client = new VeriffClient(config);
  }

  async createSession(input: {
    userId: string;
    metadata?: Record<string, unknown>;
  }): Promise<SessionResult> {
    const { userId, metadata } = input;
    const session = (await this.client.createSession({
      verification: {
        person: {
          firstName: metadata?.firstName,
          lastName: metadata?.lastName,
          dateOfBirth: metadata?.dob,
          email: metadata?.email,
          address: metadata?.address,
          phoneNumber: metadata?.phone,
        },
      },
      externalUserId: userId,
    })) as { id: string; url: string };

    return {
      providerVerificationId: session.id,
      sessionUrl: session.url,
      metadata: { sessionId: session.id },
    };
  }

  async getStatus(providerVerificationId: string): Promise<VerificationResult> {
    const status = (await this.client.getSession(providerVerificationId)) as {
      status: string;
      decision?: { status: string };
      createdAt?: string;
    };

    let kycStatus: KycStatus;
    switch (status.status) {
      case 'pending':
        kycStatus = KycStatus.PENDING;
        break;
      case 'in_progress':
        kycStatus = KycStatus.IN_REVIEW;
        break;
      case 'completed':
        kycStatus = KycStatus.VERIFIED;
        break;
      case 'failed':
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
      verifiedAt: status.createdAt || null,
      metadata: {
        status: status.status,
        decision: status.decision?.status,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async processWebhook(
    payload: unknown,
  ): Promise<{ providerVerificationId: string; result: VerificationResult }> {
    const event = payload as { sessionId: string; status: string; decision?: { status: string } };

    let kycStatus: KycStatus;
    switch (event.status) {
      case 'pending':
        kycStatus = KycStatus.PENDING;
        break;
      case 'in_progress':
        kycStatus = KycStatus.IN_REVIEW;
        break;
      case 'completed':
        kycStatus = KycStatus.VERIFIED;
        break;
      case 'failed':
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
        metadata: {
          status: event.status,
          decision: event.decision?.status,
        },
      },
    };
  }
}
