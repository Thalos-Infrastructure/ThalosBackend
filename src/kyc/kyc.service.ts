import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  IKycProvider,
  KYC_PROVIDER,
  KycStatus,
} from '../identity-providers/interfaces/kyc-provider.interface';
import { CreateKycSessionDto } from './dto/kyc.dto';

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

/** Maps provider-level KycStatus to the verifications table `status` column. */
function mapProviderStatus(status: KycStatus): string {
  switch (status) {
    case KycStatus.PENDING:
      return 'pending';
    case KycStatus.IN_REVIEW:
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
   * Starts (or resumes) a person-level KYC verification session via the configured
   * IdentityProvider. Mirrors the KYB `createSession` pattern:
   *
   * - If a live session (pending / in_review) already exists, it is returned as-is
   *   (idempotent).
   * - If the user is already verified, the existing record is returned.
   * - If the user was previously rejected, a fresh attempt is created.
   * - Otherwise a new session is created and persisted to the `verifications` table.
   */
  async createSession(
    userId: string,
    dto: CreateKycSessionDto,
  ): Promise<{ verification: KycVerificationRecord }> {
    const existing = await this.findByUserId(userId);

    if (existing) {
      if (LIVE_STATUSES.includes(existing.status as KycStatus)) {
        // Already has a live session in flight; don't spawn a duplicate with the provider.
        return { verification: existing };
      }

      if (existing.status === 'verified') {
        return { verification: existing };
      }

      if (existing.status === 'rejected') {
        // Allow a fresh attempt: create a new session via the provider and update the row.
        const session = await this.provider.createSession({ userId, metadata: dto.metadata });

        const { data, error } = await this.supabase
          .getClient()
          .from('verifications')
          .update({
            provider_reference: session.providerVerificationId,
            status: mapProviderStatus(session.metadata?.status as KycStatus) ?? 'pending',
            level: 'none',
            verified_at: null,
            expires_at: null,
            metadata: { ...session.metadata, sessionUrl: session.sessionUrl },
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (error) {
          throw new BadRequestException(error.message);
        }
        return { verification: data as KycVerificationRecord };
      }
    }

    // Create a brand-new session via the provider.
    const session = await this.provider.createSession({ userId, metadata: dto.metadata });
    const providerStatus = (session.metadata?.status as KycStatus) ?? KycStatus.PENDING;

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
        verified_at: providerStatus === KycStatus.VERIFIED ? new Date().toISOString() : null,
        metadata: { ...session.metadata, sessionUrl: session.sessionUrl },
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
          return { verification: raced };
        }
      }
      throw new BadRequestException(error.message);
    }

    return { verification: data as KycVerificationRecord };
  }
}
