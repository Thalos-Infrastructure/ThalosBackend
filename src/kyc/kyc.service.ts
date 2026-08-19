import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SupabaseService } from '../supabase/supabase.service';
import {
  IKycProvider,
  KYC_PROVIDER,
  KycStatus,
} from '../identity-providers/interfaces/kyc-provider.interface';
import { CreateKycSessionDto } from './dto/kyc.dto';

interface WebhookResult {
  providerVerificationId: string;
  result: {
    status: KycStatus;
    verifiedAt: string | null;
  };
}

/** Row shape stored in `public.verifications` for a KYC record. */
export interface KycVerificationRecord {
  id: string;
  subject_type: 'user';
  subject_id: string;
  provider: string;
  provider_reference: string | null;
  status: string;
  level: string;
  verified_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Statuses that represent a live, in-flight session. */
const LIVE_STATUSES: KycStatus[] = [KycStatus.PENDING, KycStatus.IN_REVIEW];

/**
 * Maps provider-level KycStatus to the verifications table `status` column.
 *
 * NOTE: The provider may return `in_review`, but the `verifications` table
 * CHECK constraint (004) only allows: pending, verified, rejected, expired.
 * Both `PENDING` and `IN_REVIEW` map to DB `pending` so the in-flight
 * distinction is carried in the `metadata` JSON, not the status column.
 */
function mapProviderStatus(status: KycStatus): string {
  switch (status) {
    case KycStatus.PENDING:
      return 'pending';
    case KycStatus.IN_REVIEW:
      // Maps to 'pending' in DB — see note above.
      return 'pending';
    case KycStatus.VERIFIED:
      return 'verified';
    case KycStatus.REJECTED:
      return 'rejected';
    case KycStatus.EXPIRED:
      return 'expired';
    default:
      return 'pending';
  }
}

/** Statuses that allow a fresh provider attempt (re-create + update). */
const RETRYABLE_STATUSES = new Set(['rejected', 'expired', 'unverified']);

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(KYC_PROVIDER) private readonly provider: IKycProvider,
  ) {}

  /**
   * Finds an existing KYC verification record for the given user.
   * Uses the unique (subject_type, subject_id, provider) index.
   */
  private async findByUserId(userId: string): Promise<KycVerificationRecord | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('verifications')
      .select('*')
      .eq('subject_type', 'user')
      .eq('subject_id', userId)
      .eq('provider', this.provider.name)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data as KycVerificationRecord) ?? null;
  }

  /**
   * Creates or updates a verification row after a fresh provider session.
   * Used for both new inserts and retryable-status updates (rejected, expired, unverified).
   */
  private async upsertVerification(
    userId: string,
    existingId: string | null,
    metadata: Record<string, unknown>,
    sessionUrl: string,
  ): Promise<KycVerificationRecord> {
    const session = await this.provider.createSession({ userId, metadata });
    const providerStatus = (session.metadata?.status as KycStatus) ?? KycStatus.PENDING;
    const mergedMetadata = { ...session.metadata, sessionUrl: session.sessionUrl ?? sessionUrl };

    const now = new Date().toISOString();

    if (existingId) {
      // Update an existing row (retryable status: rejected, expired, unverified).
      const { data, error } = await this.supabase
        .getClient()
        .from('verifications')
        .update({
          provider_reference: session.providerVerificationId,
          status: mapProviderStatus(providerStatus),
          level: 'none',
          verified_at: null,
          expires_at: null,
          metadata: mergedMetadata,
          updated_at: now,
        })
        .eq('id', existingId)
        .select()
        .single();

      if (error) {
        throw new BadRequestException(error.message);
      }
      return data as KycVerificationRecord;
    }

    // Insert a brand-new row.
    const { data, error } = await this.supabase
      .getClient()
      .from('verifications')
      .insert({
        subject_type: 'user',
        subject_id: userId,
        provider: this.provider.name,
        provider_reference: session.providerVerificationId,
        status: mapProviderStatus(providerStatus),
        level: 'none',
        verified_at: providerStatus === KycStatus.VERIFIED ? now : null,
        metadata: mergedMetadata,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation: a concurrent request inserted first. Treat as
      // "already exists" and return the existing row instead of surfacing a raw
      // DB error for a legitimate race condition.
      if ((error as { code?: string }).code === '23505') {
        const raced = await this.findByUserId(userId);
        if (raced) {
          return raced;
        }
      }
      throw new BadRequestException(error.message);
    }

    return data as KycVerificationRecord;
  }

  /**
   * Starts (or resumes) a person-level KYC verification session via the configured
   * IdentityProvider. Mirrors the KYB `createSession` pattern:
   *
   * - If a live session (pending / in_review) already exists, it is returned as-is
   *   (idempotent).
   * - If the user is already verified, the existing record is returned.
   * - If the user was previously rejected, expired, or unverified, a fresh attempt
   *   is created: the provider is called again and the existing row is updated.
   * - Otherwise a new session is created and persisted to the `verifications` table.
   */
  async createSession(
    userId: string,
    dto: CreateKycSessionDto,
  ): Promise<{ verification: KycVerificationRecord }> {
    const existing = await this.findByUserId(userId);

    if (existing) {
      // Live session already in flight — return as-is (idempotent).
      if (LIVE_STATUSES.includes(existing.status as KycStatus)) {
        return { verification: existing };
      }

      // Already verified — nothing to do.
      if (existing.status === 'verified') {
        return { verification: existing };
      }

      // Retryable status (rejected, expired, unverified) — create a fresh
      // provider session and update the existing row.
      if (RETRYABLE_STATUSES.has(existing.status)) {
        const verification = await this.upsertVerification(
          userId,
          existing.id,
          dto.metadata ?? {},
          '',
        );
        return { verification };
      }
    }

    // No existing record — create a brand-new session.
    const verification = await this.upsertVerification(userId, null, dto.metadata ?? {}, '');
    return { verification };
  }

  @OnEvent('kyc.webhook.processed')
  async handleWebhookProcessed(payload: WebhookResult) {
    const { providerVerificationId, result } = payload;
    const now = new Date().toISOString();
    const mappedStatus = mapProviderStatus(result.status);
    const isVerified = result.status === KycStatus.VERIFIED;

    const { data, error } = await this.supabase
      .getClient()
      .from('verifications')
      .update({
        status: mappedStatus,
        verified_at: isVerified ? (result.verifiedAt ?? now) : null,
        updated_at: now,
      })
      .eq('provider_reference', providerVerificationId)
      .select();

    if (error) {
      this.logger.error(`Failed to update KYC status from webhook: ${error.message}`);
    } else if (!data || data.length === 0) {
      this.logger.warn(`Webhook processed for unknown provider reference: ${providerVerificationId}`);
    } else {
      this.logger.log(`Webhook updated KYC status to ${mappedStatus} for reference: ${providerVerificationId}`);
    }
  }
}
