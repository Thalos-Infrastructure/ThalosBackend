import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { AttachPrDto } from './dto/attach-pr.dto';
import * as crypto from 'crypto';

/** Shape returned by the GitHub Search API for pull request items. */
interface GitHubSearchPRItem {
  number: number;
  title: string;
  html_url: string;
  pull_request?: { merged_at: string | null };
}

/** Shape of a cached merged-PR search result. */
interface CachedPRResult {
  prs: MergedPR[];
  expiresAt: number;
}

/** Public shape for a merged PR. */
export interface MergedPR {
  repo: string;
  number: number;
  title: string;
  url: string;
  merged_at: string;
}

/** Shape for an attached PR row from the database. */
export interface AttachedPR {
  id: string;
  agreement_id: string;
  milestone_index: number;
  repo: string;
  pr_number: number;
  title: string;
  url: string;
  merged_at: string;
  attached_by: string;
  created_at: string;
}


@Injectable()
export class GitHubEvidenceService {
  private readonly logger = new Logger(GitHubEvidenceService.name);

  /** In-memory TTL cache for merged PR searches. Key: "repo:username" */
  private readonly prCache = new Map<string, CachedPRResult>();
  private readonly CACHE_TTL_MS = 60_000; // 60 seconds

  private readonly githubToken: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly jwtSecret: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {
    this.githubToken = this.config.get<string>('GITHUB_TOKEN', '');
    this.clientId = this.config.get<string>('GITHUB_CLIENT_ID', '');
    this.clientSecret = this.config.get<string>('GITHUB_CLIENT_SECRET', '');
    this.jwtSecret = this.config.get<string>('JWT_SECRET', '');
  }

  // ── OAuth flow ──────────────────────────────────────────────────────────

  /**
   * Generates a GitHub OAuth authorization URL with an HMAC-signed state
   * parameter that encodes the user ID (CSRF protection).
   */
  async getOAuthUrl(userId: string): Promise<{ url: string; error: null }> {
    const state = this.signState(userId);
    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: 'read:user',
      state,
    });
    return {
      url: `https://github.com/login/oauth/authorize?${params.toString()}`,
      error: null,
    };
  }

  /**
   * Handles the OAuth callback: validates state, exchanges code for a token,
   * reads the GitHub username, writes it to the profile, and discards the token.
   */
  async handleOAuthCallback(
    code: string,
    state: string,
  ): Promise<{ github_username: string; github_verified_at: string; error: null }> {
    // 1. Validate HMAC state
    const userId = this.verifyState(state);

    // 2. Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      throw new HttpException(
        {
          success: false,
          error: tokenData.error_description || 'Failed to exchange GitHub OAuth code',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Fetch the authenticated GitHub user
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Thalos-Backend',
      },
    });

    if (!userResponse.ok) {
      throw new HttpException(
        { success: false, error: 'Failed to fetch GitHub user profile' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const githubUser = (await userResponse.json()) as { login?: string };
    if (!githubUser.login) {
      throw new HttpException(
        { success: false, error: 'GitHub user profile missing login field' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Token is NOT stored — discarded after reading the username.

    // 4. Write github_username + github_verified_at on the profile
    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      throw new ForbiddenException('No wallet found for authenticated user');
    }

    const verifiedAt = new Date().toISOString();
    const { error: updateError } = await this.supabase
      .getClient()
      .from('profiles')
      .update({
        github_username: githubUser.login,
        github_verified_at: verifiedAt,
        updated_at: verifiedAt,
      })
      .eq('wallet_address', wallet);

    if (updateError) {
      throw new HttpException(
        { success: false, error: updateError.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.logger.log(`GitHub verified for user ${userId}: ${githubUser.login}`);

    return {
      github_username: githubUser.login,
      github_verified_at: verifiedAt,
      error: null,
    };
  }

  /**
   * Removes the GitHub link from the authenticated user's profile.
   */
  async unlinkGitHub(userId: string): Promise<{ success: boolean; error: string | null }> {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      throw new ForbiddenException('No wallet found for authenticated user');
    }

    const { error } = await this.supabase
      .getClient()
      .from('profiles')
      .update({
        github_username: null,
        github_verified_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', wallet);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  }

  // ── Merged PR search ────────────────────────────────────────────────────

  /**
   * Searches GitHub for merged PRs scoped to a specific repo authored by the
   * authenticated user's verified GitHub username.
   *
   * Query: repo:{owner}/{repo} author:{username} is:pr is:merged
   * Uses GITHUB_TOKEN for authenticated rate limits (30 req/min).
   * Results are cached in-memory for 60s per repo+username.
   */
  async getMergedPRs(
    userId: string,
    repo: string,
  ): Promise<{ prs: MergedPR[]; error: string | null }> {
    const githubUsername = await this.getVerifiedGitHubUsername(userId);

    // Check in-memory cache
    const cacheKey = `${repo}:${githubUsername}`;
    const cached = this.prCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { prs: cached.prs, error: null };
    }

    // Build the repo-scoped search query
    const query = `repo:${repo} author:${githubUsername} is:pr is:merged`;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=100&sort=updated&order=desc`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Thalos-Backend',
    };
    if (this.githubToken) {
      headers['Authorization'] = `Bearer ${this.githubToken}`;
    }

    const response = await fetch(url, { headers });

    // Handle rate limits
    this.checkRateLimit(response);

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as { message?: string };
      return {
        prs: [],
        error: errBody.message || `GitHub API error: ${response.status}`,
      };
    }

    const data = (await response.json()) as { items?: GitHubSearchPRItem[] };
    const prs: MergedPR[] = (data.items ?? [])
      .filter((item) => item.pull_request?.merged_at)
      .map((item) => ({
        repo,
        number: item.number,
        title: item.title,
        url: item.html_url,
        merged_at: item.pull_request!.merged_at!,
      }));

    // Cache the result
    this.prCache.set(cacheKey, {
      prs,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    return { prs, error: null };
  }

  // ── PR attachment CRUD ──────────────────────────────────────────────────

  /**
   * Attaches a merged PR to a specific milestone on an agreement.
   */
  async attachPR(
    userId: string,
    agreementId: string,
    milestoneIndex: number,
    dto: AttachPrDto,
  ): Promise<{ success: boolean; error: string | null }> {
    await this.assertCanAccessAgreement(userId, agreementId);
    await this.assertActorWallet(userId, dto.actor_wallet);
    await this.assertValidMilestoneIndex(agreementId, milestoneIndex);

    const { error } = await this.supabase
      .getClient()
      .from('milestone_evidence_prs')
      .insert({
        agreement_id: agreementId,
        milestone_index: milestoneIndex,
        repo: dto.repo,
        pr_number: dto.pr_number,
        title: dto.title,
        url: dto.url,
        merged_at: dto.merged_at,
        attached_by: dto.actor_wallet,
      });

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'This PR is already attached to this milestone' };
      }
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  }

  /**
   * Detaches a PR from a milestone.
   */
  async detachPR(
    userId: string,
    agreementId: string,
    milestoneIndex: number,
    prId: string,
  ): Promise<{ success: boolean; error: string | null }> {
    await this.assertCanAccessAgreement(userId, agreementId);

    const { error, count } = await this.supabase
      .getClient()
      .from('milestone_evidence_prs')
      .delete({ count: 'exact' })
      .eq('id', prId)
      .eq('agreement_id', agreementId)
      .eq('milestone_index', milestoneIndex);

    if (error) {
      return { success: false, error: error.message };
    }

    if (count === 0) {
      throw new NotFoundException('PR evidence not found on this milestone');
    }

    return { success: true, error: null };
  }

  /**
   * Lists all PRs attached to a specific milestone.
   */
  async getAttachedPRs(
    userId: string,
    agreementId: string,
    milestoneIndex: number,
  ): Promise<{ prs: AttachedPR[]; error: string | null }> {
    await this.assertCanAccessAgreement(userId, agreementId);

    const { data, error } = await this.supabase
      .getClient()
      .from('milestone_evidence_prs')
      .select('*')
      .eq('agreement_id', agreementId)
      .eq('milestone_index', milestoneIndex)
      .order('created_at', { ascending: false });

    if (error) {
      return { prs: [], error: error.message };
    }

    return { prs: (data as AttachedPR[]) ?? [], error: null };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Creates an HMAC-signed state parameter encoding the userId. */
  private signState(userId: string): string {
    const payload = Buffer.from(userId).toString('base64url');
    const hmac = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(payload)
      .digest('base64url');
    return `${payload}.${hmac}`;
  }

  /** Verifies and extracts the userId from an HMAC-signed state parameter. */
  private verifyState(state: string): string {
    const parts = state.split('.');
    if (parts.length !== 2) {
      throw new ForbiddenException('Invalid OAuth state');
    }
    const [payload, signature] = parts;
    const expected = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(payload)
      .digest('base64url');

    const bufSig = Buffer.from(signature);
    const bufExp = Buffer.from(expected);

    if (bufSig.length !== bufExp.length || !crypto.timingSafeEqual(bufSig, bufExp)) {
      throw new ForbiddenException('Invalid OAuth state signature');
    }

    return Buffer.from(payload, 'base64url').toString();
  }

  /** Reads X-RateLimit-Remaining / X-RateLimit-Reset and throws 429 when exhausted. */
  private checkRateLimit(response: Response): void {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const resetHeader = response.headers.get('x-ratelimit-reset');

    if (remaining !== null && parseInt(remaining, 10) <= 0 && response.status === 403) {
      const resetEpoch = resetHeader ? parseInt(resetHeader, 10) : 0;
      const retryAfter = Math.max(resetEpoch - Math.floor(Date.now() / 1000), 1);

      throw new HttpException(
        {
          success: false,
          error: 'GitHub API rate limit exceeded. Please try again later.',
          retry_after: retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Resolves the verified GitHub username for a user, or throws if not linked. */
  private async getVerifiedGitHubUsername(userId: string): Promise<string> {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      throw new ForbiddenException('No wallet found for authenticated user');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('github_username, github_verified_at')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Profile not found');
    }

    const profile = data as { github_username: string | null; github_verified_at: string | null };
    if (!profile.github_username || !profile.github_verified_at) {
      throw new HttpException(
        {
          success: false,
          error: 'GitHub account not linked. Complete OAuth verification first.',
        },
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }

    return profile.github_username;
  }

  /** Resolves wallet address from a JWT user ID. */
  private async walletForUserId(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('auth_users')
      .select('wallet_public_key')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data?.wallet_public_key) return null;
    return data.wallet_public_key as string;
  }

  /** Asserts that the actor_wallet matches the authenticated user's wallet. */
  private async assertActorWallet(userId: string, actorWallet: string): Promise<void> {
    const wallet = await this.walletForUserId(userId);
    if (!wallet || wallet !== actorWallet) {
      throw new ForbiddenException('Wallet does not match authenticated user');
    }
  }

  /** Asserts that the user is a participant or creator of the agreement. */
  private async assertCanAccessAgreement(userId: string, agreementId: string): Promise<void> {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) throw new ForbiddenException('No wallet on profile');

    const { data: agreement, error: aErr } = await this.supabase
      .getClient()
      .from('agreements')
      .select('id, created_by')
      .eq('id', agreementId)
      .maybeSingle();
    if (aErr || !agreement) throw new NotFoundException('Agreement not found');

    const createdBy = (agreement as { created_by: string }).created_by;
    if (createdBy === wallet || createdBy === userId) return;

    const { data: parts } = await this.supabase
      .getClient()
      .from('agreement_participants')
      .select('wallet_address')
      .eq('agreement_id', agreementId)
      .eq('wallet_address', wallet)
      .limit(1);
    if (!parts?.length) {
      throw new ForbiddenException('Not a participant of this agreement');
    }
  }

  /** Validates that the milestone index exists on the agreement. */
  private async assertValidMilestoneIndex(
    agreementId: string,
    milestoneIndex: number,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('agreements')
      .select('milestones')
      .eq('id', agreementId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Agreement not found');
    }

    const milestones = data.milestones as unknown[];
    if (!Array.isArray(milestones) || milestoneIndex < 0 || milestoneIndex >= milestones.length) {
      throw new HttpException(
        { success: false, error: 'Invalid milestone index' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
