import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  VerificationAccessContext,
  VerificationLevel,
  VerificationRecord,
  VerificationStatus,
  VerificationStatusResponse,
  VerificationSubjectType,
} from './verification.types';

/** Ordering used to pick the "highest" verification level. */
const LEVEL_RANK: Record<VerificationLevel, number> = {
  none: 0,
  basic: 1,
  standard: 2,
  advanced: 3,
};

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** KYC status for an individual user. Caller must be the user, an admin, or an internal service. */
  async getUserVerification(
    userId: string,
    ctx: VerificationAccessContext,
  ): Promise<VerificationStatusResponse> {
    await this.assertCanRead('user', userId, ctx);
    return this.getStatus('user', userId);
  }

  /** KYB status for an organization / business. Caller must be an admin or an internal service. */
  async getBusinessVerification(
    businessId: string,
    ctx: VerificationAccessContext,
  ): Promise<VerificationStatusResponse> {
    await this.assertCanRead('business', businessId, ctx);
    return this.getStatus('business', businessId);
  }

  /**
   * Guards a read against IDOR on compliance data. Access is granted when the
   * caller is a trusted internal service, is the subject itself (users only),
   * or is an admin. Everyone else gets a 403 — a valid JWT alone is not enough.
   *
   * A `business` subject has no "self" caller until org membership exists, so it
   * is intentionally limited to internal services and admins (mirrors the RLS in
   * `scripts/004_create_verifications.sql`).
   */
  private async assertCanRead(
    subjectType: VerificationSubjectType,
    subjectId: string,
    ctx: VerificationAccessContext,
  ): Promise<void> {
    if (ctx.isInternalService) return;
    if (subjectType === 'user' && ctx.callerUserId && ctx.callerUserId === subjectId) return;
    if (ctx.callerUserId && (await this.isAdmin(ctx.callerUserId))) return;
    throw new ForbiddenException('Not authorized to view this verification status');
  }

  /**
   * Resolves whether a JWT `sub` belongs to an admin. Mirrors `KybService.isAdmin`:
   * JWT user → `auth_users.wallet_public_key` → `profiles.role`.
   */
  private async isAdmin(userId: string): Promise<boolean> {
    const { data: authUser } = await this.supabase
      .getClient()
      .from('auth_users')
      .select('wallet_public_key')
      .eq('id', userId)
      .maybeSingle();

    const wallet = (authUser as { wallet_public_key?: string } | null)?.wallet_public_key;
    if (!wallet) return false;

    const { data: profile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('role')
      .eq('wallet_address', wallet)
      .maybeSingle();

    return (profile as { role?: string } | null)?.role === 'admin';
  }

  /**
   * Aggregates every provider record for a subject into a single standardized
   * response. Regardless of how many providers verified the subject, callers
   * always get the same shape — an unknown subject returns an `unverified`
   * payload rather than an error.
   */
  private async getStatus(
    subjectType: VerificationSubjectType,
    subjectId: string,
  ): Promise<VerificationStatusResponse> {
    const { data, error } = await this.supabase
      .getClient()
      .from('verifications')
      .select('*')
      .eq('subject_type', subjectType)
      .eq('subject_id', subjectId);

    if (error) {
      // Fail closed: a DB error must never be reported as "verified".
      this.logger.error(
        `Failed to load verifications for ${subjectType}:${subjectId}: ${error.message}`,
      );
      return this.notVerified(subjectType, subjectId);
    }

    const records = (data as VerificationRecord[] | null) ?? [];
    return this.aggregate(subjectType, subjectId, records);
  }

  /**
   * Reduces a subject's provider records to the effective compliance status.
   *
   * Rules:
   *  - A `verified` record whose `expires_at` is in the past counts as expired.
   *  - `isVerified` is true iff at least one record is currently-valid `verified`.
   *  - When verified, `level`/`provider`/`expiresAt` come from the highest-level
   *    valid record (ties broken by the most recent `updated_at`).
   *  - When not verified, `status` reflects the most advanced state present
   *    (pending > expired > rejected > unverified) so callers can see progress.
   *  - `lastUpdated` is the most recent `updated_at` across all records.
   */
  private aggregate(
    subjectType: VerificationSubjectType,
    subjectId: string,
    records: VerificationRecord[],
  ): VerificationStatusResponse {
    if (records.length === 0) {
      return this.notVerified(subjectType, subjectId);
    }

    const now = Date.now();
    const isExpired = (r: VerificationRecord): boolean =>
      r.expires_at != null && new Date(r.expires_at).getTime() <= now;

    const updatedTimes = records
      .map((r) => r.updated_at)
      .filter((v): v is string => Boolean(v))
      .sort();
    const lastUpdated = updatedTimes.length > 0 ? updatedTimes[updatedTimes.length - 1] : null;

    // Currently-valid verified records, best (highest level, then newest) first.
    const validVerified = records
      .filter((r) => r.status === 'verified' && !isExpired(r))
      .sort((a, b) => {
        const byLevel = LEVEL_RANK[b.level] - LEVEL_RANK[a.level];
        if (byLevel !== 0) return byLevel;
        return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
      });

    if (validVerified.length > 0) {
      const best = validVerified[0];
      return {
        subjectType,
        subjectId,
        isVerified: true,
        status: 'verified',
        level: best.level,
        provider: best.provider,
        expiresAt: best.expires_at,
        lastUpdated,
      };
    }

    return {
      subjectType,
      subjectId,
      isVerified: false,
      status: this.effectiveUnverifiedStatus(records, isExpired),
      level: 'none',
      provider: null,
      expiresAt: null,
      lastUpdated,
    };
  }

  private effectiveUnverifiedStatus(
    records: VerificationRecord[],
    isExpired: (r: VerificationRecord) => boolean,
  ): VerificationStatus {
    const has = (s: VerificationStatus): boolean => records.some((r) => r.status === s);
    if (has('pending')) return 'pending';
    // Either an explicit `expired` row, or a `verified` row past its expiry.
    if (has('expired') || records.some((r) => r.status === 'verified' && isExpired(r))) {
      return 'expired';
    }
    if (has('rejected')) return 'rejected';
    return 'unverified';
  }

  private notVerified(
    subjectType: VerificationSubjectType,
    subjectId: string,
  ): VerificationStatusResponse {
    return {
      subjectType,
      subjectId,
      isVerified: false,
      status: 'unverified',
      level: 'none',
      provider: null,
      expiresAt: null,
      lastUpdated: null,
    };
  }
}
