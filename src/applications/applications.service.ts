import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateApplicationDto,
  ListApplicationsQueryDto,
  UpdateApplicationStatusDto,
} from './dto/applications.dto';

export type ApplicationStatus = 'pending' | 'accepted' | 'rejected';

export interface Application {
  id: string;
  opportunity_id: string;
  builder_id: string;
  message: string;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ApplicationsService {
  constructor(private readonly supabase: SupabaseService) {}

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Returns the auth.users row for `userId`, or throws if not found.
   * Used to verify that the caller is who they claim to be.
   */
  private async assertUserExists(userId: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('auth_users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      throw new ForbiddenException('Authenticated user not found');
    }
  }

  /**
   * Looks up the opportunity and returns its `owner_id`.
   * Throws NotFoundException if the opportunity does not exist.
   */
  private async getOpportunityOwnerId(opportunityId: string): Promise<string> {
    const { data, error } = await this.supabase
      .getClient()
      .from('opportunities')
      .select('id, owner_id')
      .eq('id', opportunityId)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }

    return data.owner_id as string;
  }

  /**
   * Asserts that `userId` is the owner of the given opportunity.
   * Throws ForbiddenException otherwise.
   */
  private async assertIsOpportunityOwner(userId: string, opportunityId: string): Promise<void> {
    const ownerId = await this.getOpportunityOwnerId(opportunityId);
    if (ownerId !== userId) {
      throw new ForbiddenException('Only the opportunity owner can perform this action');
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * POST /applications
   * Builder submits an application for an opportunity.
   * One application per (opportunity, builder) — duplicates are rejected.
   */
  async apply(userId: string, dto: CreateApplicationDto) {
    await this.assertUserExists(userId);

    // Verify the opportunity exists.
    await this.getOpportunityOwnerId(dto.opportunity_id);

    const { data, error } = await this.supabase
      .getClient()
      .from('applications')
      .insert({
        opportunity_id: dto.opportunity_id,
        builder_id: userId,
        message: dto.message ?? '',
      })
      .select()
      .single();

    if (error) {
      // Postgres unique-constraint violation: duplicate application.
      if (error.code === '23505') {
        throw new ConflictException('You have already applied to this opportunity');
      }
      return { application: null, error: error.message };
    }

    return { application: data as Application, error: null };
  }

  /**
   * GET /applications?opportunity_id=
   * Returns all applications for an opportunity.
   * Only the opportunity owner may call this.
   */
  async listApplicants(userId: string, query: ListApplicationsQueryDto) {
    await this.assertIsOpportunityOwner(userId, query.opportunity_id);

    const { data, error } = await this.supabase
      .getClient()
      .from('applications')
      .select('*')
      .eq('opportunity_id', query.opportunity_id)
      .order('created_at', { ascending: true });

    if (error) return { applications: [], error: error.message };
    return { applications: (data ?? []) as Application[], error: null };
  }

  /**
   * PATCH /applications/:id
   * Owner accepts or rejects an application.
   * Only the opportunity owner may call this.
   *
   * When status is set to 'accepted', the opportunity's `filled_at` timestamp
   * is updated (if the `opportunities` table has that column) so the opportunity
   * appears as filled to the frontend.  The frontend is then responsible for
   * spinning up the existing Thalos Agreement flow pre-filled from the
   * opportunity data — no new on-chain path is created here.
   */
  async updateStatus(userId: string, applicationId: string, dto: UpdateApplicationStatusDto) {
    // Look up the application first so we can enforce ownership.
    const { data: existing, error: fetchErr } = await this.supabase
      .getClient()
      .from('applications')
      .select('id, opportunity_id, status')
      .eq('id', applicationId)
      .maybeSingle();

    if (fetchErr || !existing) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }

    await this.assertIsOpportunityOwner(userId, existing.opportunity_id as string);

    if (existing.status !== 'pending') {
      throw new ConflictException(
        `Application is already ${existing.status} and cannot be changed`,
      );
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('applications')
      .update({ status: dto.status })
      .eq('id', applicationId)
      .select()
      .single();

    if (error) return { application: null, error: error.message };

    // If accepted, mark the opportunity as filled (best-effort — the
    // `filled_at` column may not exist yet; we never let this block the
    // primary response).
    if (dto.status === 'accepted') {
      await this.supabase
        .getClient()
        .from('opportunities')
        .update({ filled_at: new Date().toISOString() })
        .eq('id', existing.opportunity_id)
        .then(() => {
          /* swallow — filled_at column is optional; missing it is non-fatal */
        });
    }

    return { application: data as Application, error: null };
  }
}
