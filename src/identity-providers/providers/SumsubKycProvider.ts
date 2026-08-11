import {
  IKycProvider,
  KycStatus,
  SessionResult,
  VerificationResult,
} from '../interfaces/kyc-provider.interface';
import { IdentityProviderConfig } from '../abstraction/IdentityConfigManager';
import { SumsubClient } from './sumsub/SumsubClient';

export class SumsubKycProvider implements IKycProvider {
  readonly name = 'sumsub';
  private client: SumsubClient;

  constructor(config: IdentityProviderConfig) {
    this.client = new SumsubClient(config);
  }

  async createSession(input: {
    userId: string;
    metadata?: Record<string, unknown>;
  }): Promise<SessionResult> {
    const { userId, metadata } = input;
    const applicant = (await this.client.createApplicant(userId, metadata)) as {
      externalUserId: string;
    };
    const token = (await this.client.generateAccessToken(applicant.externalUserId)) as {
      token: string;
    };
    const sessionUrl = `https://frontend.sumsub.com/websdk/sdk?accessToken=${token.token}`;
    return {
      providerVerificationId: applicant.externalUserId,
      sessionUrl,
      metadata: { applicantId: applicant.externalUserId },
    };
  }

  async getStatus(providerVerificationId: string): Promise<VerificationResult> {
    const status = (await this.client.getApplicantStatus(providerVerificationId)) as {
      reviewStatus: string;
      reviewResult?: { reviewAnswer: string };
      created_at?: string;
    };
    const reviewAnswer = status.reviewResult?.reviewAnswer;
    let kycStatus: KycStatus;
    if (reviewAnswer === 'GREEN') kycStatus = KycStatus.VERIFIED;
    else if (reviewAnswer === 'RED') kycStatus = KycStatus.REJECTED;
    else kycStatus = KycStatus.IN_REVIEW;
    return {
      status: kycStatus,
      verifiedAt: status.created_at || null,
      metadata: { reviewStatus: status.reviewStatus },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async processWebhook(
    payload: unknown,
  ): Promise<{ providerVerificationId: string; result: VerificationResult }> {
    const event = payload as {
      applicantId: string;
      reviewStatus: string;
      reviewResult?: { reviewAnswer: string };
    };
    const kycStatus =
      event.reviewResult?.reviewAnswer === 'GREEN'
        ? KycStatus.VERIFIED
        : event.reviewResult?.reviewAnswer === 'RED'
          ? KycStatus.REJECTED
          : KycStatus.IN_REVIEW;
    return {
      providerVerificationId: event.applicantId,
      result: {
        status: kycStatus,
        verifiedAt: null,
        metadata: { reviewStatus: event.reviewStatus },
      },
    };
  }
}
