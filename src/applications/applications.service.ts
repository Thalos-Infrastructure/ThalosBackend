import {
  BadRequestException,
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
import type { Application } from './application.types';

@Injectable()
export class ApplicationsService {
  constructor(private readonly supabase: SupabaseService) {}

  // -------------------------------------------------------------------------
  // Ownership resolution — mirrors opportunities.service.ts
  // -------------------------------------------------------------------------

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

  private async resolveCallerProfile(
    userId: string,
  ): Promise<{ id: string; account_type: 'personal' | 'enterprise' }> {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      throw new ForbiddenException('No wallet on profile');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id, account_type')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (error || !data?.id) {
      throw new ForbiddenException('No Project profile for this user');
    }
    return {
      id: data.id as string,
      account_type: data.account_type as 'personal' | 'enterprise',
    };
  }

  private async requireCallerProfileId(userId: string): Promise<string> {
    const profile = await this.resolveCallerProfile(userId);
    return profile.id;
  }

  private async requireProjectProfileId(userId: string): Promise<string> {
    const profile = await this.resolveCallerProfile(userId);
    if (profile.account_type !== 'enterprise') {
      throw new ForbiddenException('Only a Project can manage opportunities');
    }
    return profile.id;
  }

  // -------------------------------------------------------------------------
  // Data access helpers
  // -------------------------------------------------------------------------

  private async loadOpportunity(id: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('opportunities')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Opportunity not found');
    return data as {
      id: string;
      project_id: string;
      status: string;
      [key: string]: unknown;
    };
  }

  private async assertOpportunityOwner(userId: string, opportunityId: string) {
    const opportunity = await this.loadOpportunity(opportunityId);
    const projectId = await this.requireProjectProfileId(userId);
    if (opportunity.project_id !== projectId) {
      throw new ForbiddenException('Only the owning Project can perform this action');
    }
    return opportunity;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * POST /applications — builder applies to an opportunity.
   * One application per (opportunity, builder) — duplicates are rejected.
   * Owner cannot apply to their own opportunity.
   */
  async apply(userId: string, dto: CreateApplicationDto) {
    const profileId = await this.requireCallerProfileId(userId);
    const opportunity = await this.loadOpportunity(dto.opportunity_id);

    // Block owner from applying to their own opportunity.
    if (opportunity.project_id === profileId) {
      throw new ForbiddenException('Projects cannot apply to their own opportunities');
    }

    // Only open opportunities accept applications.
    if (opportunity.status !== 'open') {
      throw new ConflictException('This opportunity is no longer open');
    }

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
      throw new BadRequestException(error.message);
    }

    return { application: data as Application, error: null };
  }

  /**
   * GET /applications?opportunity_id=
   * Owner sees all applicants. Non-owner sees only their own application.
   */
  async listApplicants(userId: string, query: ListApplicationsQueryDto) {
    const opportunity = await this.loadOpportunity(query.opportunity_id);
    let profileId: string;
    try {
      profileId = await this.requireProjectProfileId(userId);
    } catch {
      // Not an enterprise profile — fall through to builder path.
      profileId = '';
    }

    const isOwner = opportunity.project_id === profileId;

    if (isOwner) {
      // Owner: return all applications for this opportunity.
      const { data, error } = await this.supabase
        .getClient()
        .from('applications')
        .select('*')
        .eq('opportunity_id', query.opportunity_id)
        .order('created_at', { ascending: true });

      if (error) throw new BadRequestException(error.message);
      return { applications: (data ?? []) as Application[], error: null };
    }

    // Non-owner: return only the caller's own application.
    const { data, error } = await this.supabase
      .getClient()
      .from('applications')
      .select('*')
      .eq('opportunity_id', query.opportunity_id)
      .eq('builder_id', userId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    return { applications: data ? [data as Application] : [], error: null };
  }

  /**
   * PATCH /applications/:id — owner accepts or rejects an application.
   * On accept: opportunity status → filled, other pending apps → rejected.
   */
  async updateStatus(userId: string, applicationId: string, dto: UpdateApplicationStatusDto) {
    // Fetch the application.
    const { data: existing, error: fetchErr } = await this.supabase
      .getClient()
      .from('applications')
      .select('id, opportunity_id, status')
      .eq('id', applicationId)
      .maybeSingle();

    if (fetchErr || !existing) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }

    // Verify caller is the opportunity owner.
    await this.assertOpportunityOwner(userId, existing.opportunity_id as string);

    if (existing.status !== 'pending') {
      throw new ConflictException(
        `Application is already ${existing.status} and cannot be changed`,
      );
    }

    // Update the application status.
    const { data, error } = await this.supabase
      .getClient()
      .from('applications')
      .update({ status: dto.status })
      .eq('id', applicationId)
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);

    if (dto.status === 'accepted') {
      // Mark the opportunity as filled.
      const { error: oppError } = await this.supabase
        .getClient()
        .from('opportunities')
        .update({ status: 'filled' })
        .eq('id', existing.opportunity_id);

      if (oppError) {
        throw new BadRequestException(
          `Application accepted but failed to mark opportunity as filled: ${oppError.message}`,
        );
      }

      // Reject all other pending applications for this opportunity.
      await this.supabase
        .getClient()
        .from('applications')
        .update({ status: 'rejected' })
        .eq('opportunity_id', existing.opportunity_id)
        .eq('status', 'pending')
        .neq('id', applicationId);
    }

    return { application: data as Application, error: null };
  }
}
