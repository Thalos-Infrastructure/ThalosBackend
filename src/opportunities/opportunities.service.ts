import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateOpportunityDto,
  DiscoverOpportunitiesQueryDto,
  UpdateOpportunityDto,
} from './dto/opportunities.dto';
import { isAllowedStatusTransition, type Opportunity } from './opportunity.types';

@Injectable()
export class OpportunitiesService {
  constructor(private readonly supabase: SupabaseService) {}

  async create(userId: string, dto: CreateOpportunityDto) {
    const projectId = await this.requireCallerProfileId(userId);
    if (dto.project_id && dto.project_id !== projectId) {
      throw new ForbiddenException('project_id does not match the authenticated Project');
    }

    const row = {
      project_id: projectId,
      title: dto.title,
      description: dto.description,
      skills_required: dto.skills_required,
      budget_amount: dto.budget_amount,
      budget_asset: dto.budget_asset ?? 'USDC',
      engagement_type: dto.engagement_type,
      status: 'open' as const,
    };

    const { data, error } = await this.supabase
      .getClient()
      .from('opportunities')
      .insert(row)
      .select()
      .single();

    if (error || !data) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'OPPORTUNITY_CREATE_FAILED',
          details: [
            {
              field: 'body',
              code: 'OPPORTUNITY_CREATE_FAILED',
              message: error?.message ?? 'Failed to create opportunity',
            },
          ],
        },
      });
    }

    return { opportunity: data as Opportunity, error: null };
  }

  async listMine(userId: string) {
    const projectId = await this.requireCallerProfileId(userId);
    const { data, error } = await this.supabase
      .getClient()
      .from('opportunities')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      return { opportunities: [] as Opportunity[], error: error.message };
    }
    return { opportunities: (data as Opportunity[]) ?? [], error: null };
  }

  async discover(query: DiscoverOpportunitiesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (
      query.budget_min !== undefined &&
      query.budget_max !== undefined &&
      query.budget_min > query.budget_max
    ) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: [
            {
              field: 'budget_min',
              code: 'VALIDATION_ERROR',
              message: 'budget_min must be less than or equal to budget_max',
            },
          ],
        },
      });
    }

    let builder = this.supabase
      .getClient()
      .from('opportunities')
      .select('*', { count: 'exact' })
      .eq('status', 'open');

    if (query.engagement_type) {
      builder = builder.eq('engagement_type', query.engagement_type);
    }
    if (query.skills_required?.length) {
      builder = builder.overlaps('skills_required', query.skills_required);
    }
    if (query.budget_min !== undefined) {
      builder = builder.gte('budget_amount', query.budget_min);
    }
    if (query.budget_max !== undefined) {
      builder = builder.lte('budget_amount', query.budget_max);
    }
    if (query.q) {
      const sanitized = query.q.replace(/[%_,]/g, '').trim();
      if (sanitized) {
        builder = builder.or(`title.ilike.%${sanitized}%,description.ilike.%${sanitized}%`);
      }
    }

    const { data, error, count } = await builder
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return { opportunities: [] as Opportunity[], page, limit, total: 0, error: error.message };
    }

    return {
      opportunities: (data as Opportunity[]) ?? [],
      page,
      limit,
      total: count ?? 0,
      error: null,
    };
  }

  async getById(userId: string, id: string) {
    const opportunity = await this.load(id);
    if (opportunity.status === 'open') {
      return { opportunity, error: null };
    }

    const projectId = await this.requireCallerProfileId(userId);
    if (opportunity.project_id !== projectId) {
      throw new NotFoundException('Opportunity not found');
    }
    return { opportunity, error: null };
  }

  async update(userId: string, id: string, dto: UpdateOpportunityDto) {
    const existing = await this.requireOwner(userId, id);
    const patch: Record<string, unknown> = {};

    if (dto.status !== undefined) {
      if (!isAllowedStatusTransition(existing.status, dto.status)) {
        throw new BadRequestException({
          success: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            details: [
              {
                field: 'status',
                code: 'INVALID_STATUS_TRANSITION',
                message: `Cannot transition from ${existing.status} to ${dto.status}. Allowed: open → closed, open → filled.`,
              },
            ],
          },
        });
      }
      patch.status = dto.status;
    }

    const fieldUpdates: Array<[keyof UpdateOpportunityDto, unknown]> = [
      ['title', dto.title],
      ['description', dto.description],
      ['skills_required', dto.skills_required],
      ['budget_amount', dto.budget_amount],
      ['budget_asset', dto.budget_asset],
      ['engagement_type', dto.engagement_type],
    ];
    const hasFieldUpdates = fieldUpdates.some(([, value]) => value !== undefined);

    if (hasFieldUpdates && existing.status !== 'open') {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'OPPORTUNITY_NOT_EDITABLE',
          details: [
            {
              field: 'status',
              code: 'OPPORTUNITY_NOT_EDITABLE',
              message: 'Only open opportunities can have their fields edited',
            },
          ],
        },
      });
    }

    for (const [key, value] of fieldUpdates) {
      if (value !== undefined) patch[key] = value;
    }

    if (Object.keys(patch).length === 0) {
      return { opportunity: existing, error: null };
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('opportunities')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'OPPORTUNITY_UPDATE_FAILED',
          details: [
            {
              field: 'body',
              code: 'OPPORTUNITY_UPDATE_FAILED',
              message: error?.message ?? 'Failed to update opportunity',
            },
          ],
        },
      });
    }

    return { opportunity: data as Opportunity, error: null };
  }

  async remove(userId: string, id: string) {
    await this.requireOwner(userId, id);
    const { error } = await this.supabase.getClient().from('opportunities').delete().eq('id', id);
    if (error) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'OPPORTUNITY_DELETE_FAILED',
          details: [
            {
              field: 'id',
              code: 'OPPORTUNITY_DELETE_FAILED',
              message: error.message,
            },
          ],
        },
      });
    }
    return { success: true, error: null };
  }

  private async load(id: string): Promise<Opportunity> {
    const { data, error } = await this.supabase
      .getClient()
      .from('opportunities')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    if (!data) {
      throw new NotFoundException('Opportunity not found');
    }
    return data as Opportunity;
  }

  private async requireOwner(userId: string, id: string): Promise<Opportunity> {
    const opportunity = await this.load(id);
    const projectId = await this.requireCallerProfileId(userId);
    if (opportunity.project_id !== projectId) {
      throw new ForbiddenException('Only the owning Project can modify this opportunity');
    }
    return opportunity;
  }

  private async requireCallerProfileId(userId: string): Promise<string> {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      throw new ForbiddenException('No wallet on profile');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (error || !data?.id) {
      throw new ForbiddenException('No Project profile for this user');
    }
    return data.id as string;
  }

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
}
