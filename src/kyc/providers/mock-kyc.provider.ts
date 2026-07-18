import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  IIdentityProvider,
  CreateSessionInput,
  VerificationResult,
} from '../interfaces/identity-provider.interface';
import { KycStatus } from '../interfaces/kyc.types';

@Injectable()
export class MockKycProvider implements IIdentityProvider {
  readonly name = 'mock-kyc';
  private readonly logger = new Logger(MockKycProvider.name);
  private readonly sessions = new Map<
    string,
    { status: KycStatus; verifiedAt: string | null; createdAt: string }
  >();

  createSession(input: CreateSessionInput) {
    const providerVerificationId = randomUUID();
    const createdAt = new Date().toISOString();

    this.sessions.set(providerVerificationId, {
      status: KycStatus.Pending,
      verifiedAt: null,
      createdAt,
    });

    this.logger.log(`Created KYC session ${providerVerificationId} for user ${input.userId}`);

    return Promise.resolve({
      providerVerificationId,
      metadata: { created_at: createdAt },
    });
  }

  getStatus(providerVerificationId: string): Promise<VerificationResult> {
    const session = this.sessions.get(providerVerificationId);
    if (!session) {
      throw new Error(`KYC session ${providerVerificationId} not found`);
    }

    return Promise.resolve({
      status: session.status,
      verifiedAt: session.verifiedAt,
    });
  }

  processWebhook(payload: unknown): Promise<{
    providerVerificationId: string;
    result: VerificationResult;
  }> {
    const body = payload as Record<string, unknown>;
    const providerVerificationId = body.verification_id as string;
    const newStatus = body.status as string;

    const session = this.sessions.get(providerVerificationId);
    if (!session) {
      throw new Error(`KYC session ${providerVerificationId} not found`);
    }

    const validStatuses = Object.values(KycStatus) as string[];
    const status = validStatuses.includes(newStatus)
      ? (newStatus as KycStatus)
      : KycStatus.Rejected;

    session.status = status;
    if (status === KycStatus.Verified) {
      session.verifiedAt = new Date().toISOString();
    }

    this.logger.log(`KYC session ${providerVerificationId} status updated to ${status}`);

    return Promise.resolve({
      providerVerificationId,
      result: {
        status: session.status,
        verifiedAt: session.verifiedAt,
      },
    });
  }
}
