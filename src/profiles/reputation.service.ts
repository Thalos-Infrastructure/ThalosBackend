import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Row shape from `agreement_participants` joined with agreement data. */
interface AgreementRow {
  id: string;
  status: string;
  milestones: Array<{
    status?: string;
    amount?: string;
    evidence_urls?: string[];
  }> | null;
}

/** Public-safe reputation payload returned by both endpoints. */
export interface ReputationPayload {
  /**
   * Unique public profile handle.
   * Set by Connect (#159) via the `handle` column on `profiles`.
   */
  handle: string | null;
  /** Number of agreements where this builder completed work. */
  completed_agreements_count: number;
  /** Number of milestones across the builder's agreements that have been released. */
  released_milestones_count: number;
  /**
   * Sum of released milestone amounts in USDC.
   * Null when the builder has opted out (show_earnings = false) on the public route.
   */
  total_released_usdc: number | null;
  /**
   * Whether the builder's GitHub identity has been verified via C6.
   *
   * Currently always null — will be derived from `github_verified_at IS NOT NULL`
   * once C6 GitHub evidence (#157) populates that column.
   */
  github_verified: boolean | null;
  /**
   * Number of milestones with submitted evidence URLs.
   *
   * TODO: Once milestone_evidence_prs table is available (C6 / #157),
   * derive this from attached merged PRs rather than generic URL strings.
   */
  pr_backed_milestone_count: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ReputationService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Resolves a profile by handle. Throws NotFoundException if no profile
   * with that handle exists.
   *
   * REQUIRES: Connect migration (#159) to have landed first (adds `handle`
   * column with unique partial index). Until then, PostgREST will reject
   * the `.eq('handle', …)` filter — which is fine because this endpoint
   * should not be called before #159 merges.
   */
  private async profileByHandle(handle: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id, wallet_address, handle, show_earnings')
      .eq('handle', handle)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException(`No profile found for handle "${handle}"`);
    }
    return data;
  }

  /**
   * Resolves a profile by user ID (from JWT sub). Throws NotFoundException
   * if no profile exists for this user.
   */
  private async profileByUserId(userId: string) {
    // auth_users.wallet_public_key → profiles.wallet_address
    const { data: authUser, error: authErr } = await this.supabase
      .getClient()
      .from('auth_users')
      .select('wallet_public_key')
      .eq('id', userId)
      .maybeSingle();

    if (authErr || !authUser?.wallet_public_key) {
      throw new NotFoundException('No wallet found for authenticated user');
    }

    const wallet = authUser.wallet_public_key as string;

    const { data: profile, error: profErr } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id, wallet_address, handle, show_earnings')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (profErr || !profile) {
      throw new NotFoundException('No profile found for authenticated user');
    }

    return profile;
  }

  /**
   * Fetches all agreements the builder participated in, along with their
   * status and milestone data. Uses two efficient queries (no N+1):
   *   1. agreement_participants → agreement_ids for the wallet
   *   2. agreements → status + milestones for those ids
   */
  private async fetchBuilderAgreements(walletAddress: string): Promise<AgreementRow[]> {
    // Step 1: get all agreement IDs this wallet participated in
    const { data: participations, error: partErr } = await this.supabase
      .getClient()
      .from('agreement_participants')
      .select('agreement_id')
      .eq('wallet_address', walletAddress);

    if (partErr || !participations?.length) {
      return [];
    }

    const agreementIds = participations.map((p: { agreement_id: string }) => p.agreement_id);

    // Step 2: fetch agreement data for those IDs
    const { data: agreements, error: agErr } = await this.supabase
      .getClient()
      .from('agreements')
      .select('id, status, milestones')
      .in('id', agreementIds);

    if (agErr || !agreements) {
      return [];
    }

    return agreements as AgreementRow[];
  }

  /**
   * Computes the reputation aggregate from a list of agreements.
   * Pure computation — no DB access.
   */
  private computeReputation(
    agreements: AgreementRow[],
    profile: {
      handle: string | null;
      show_earnings: boolean;
    },
    opts: { includeEarnings: boolean },
  ): ReputationPayload {
    let completed_agreements_count = 0;
    let released_milestones_count = 0;
    let total_released_usdc = 0;
    let pr_backed_milestone_count = 0;

    for (const agreement of agreements) {
      if (agreement.status === 'completed') {
        completed_agreements_count++;
      }

      const milestones = agreement.milestones ?? [];
      for (const m of milestones) {
        if (m.status === 'released') {
          released_milestones_count++;
          // Parse USDC amount (stored as string like "100.50")
          const amount = parseFloat(m.amount ?? '0');
          if (!isNaN(amount)) {
            total_released_usdc += amount;
          }
        }

        // "PR-backed" = milestone has at least one evidence URL submitted.
        // TODO: once milestone_evidence_prs table is available (C6 / #157),
        // derive from attached merged PRs instead.
        if (m.evidence_urls && m.evidence_urls.length > 0) {
          pr_backed_milestone_count++;
        }
      }
    }

    return {
      handle: profile.handle,
      completed_agreements_count,
      released_milestones_count,
      // Only include earnings when the builder has opted in AND the caller
      // is the builder themselves (via /me) or earnings are opted in.
      total_released_usdc: opts.includeEarnings ? total_released_usdc : null,
      // Will be derived from github_verified_at IS NOT NULL once C6 (#157)
      // populates that column. Null until then.
      github_verified: null,
      pr_backed_milestone_count,
    };
  }

  /**
   * Public reputation endpoint — no auth required.
   * Returns a safe subset of the reputation payload. Earnings are only
   * included when the builder has opted in via show_earnings.
   *
   * REQUIRES: Connect migration (#159) to have landed first so that the
   * `handle` column exists on `profiles`.
   */
  async getPublicReputation(handle: string): Promise<ReputationPayload> {
    const profile = await this.profileByHandle(handle);
    const agreements = await this.fetchBuilderAgreements(profile.wallet_address);

    // Public route: include earnings only when builder has opted in
    return this.computeReputation(agreements, profile, {
      includeEarnings: profile.show_earnings === true,
    });
  }

  /**
   * Authenticated reputation endpoint — returns the caller's own reputation.
   * Earnings are always included for the authenticated builder.
   */
  async getMyReputation(userId: string): Promise<ReputationPayload> {
    const profile = await this.profileByUserId(userId);
    const agreements = await this.fetchBuilderAgreements(profile.wallet_address);

    // Authenticated route: always include earnings for the builder themselves
    return this.computeReputation(agreements, profile, {
      includeEarnings: true,
    });
  }
}
