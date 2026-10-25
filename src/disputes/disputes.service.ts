import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseService } from '../supabase/supabase.service';
import { AgreementsService } from '../agreements/agreements.service';
import { validateTransition } from '../agreements/agreement.validator';
import { AgreementActivityService } from '../agreements/agreement-activity.service';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import {
  OpenDisputeDto,
  AssignResolverDto,
  ResolveDisputeDto,
  CancelDisputeDto,
  ProposeSettlementDto,
  RespondProposalDto,
} from './dto/disputes.dto';

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'cancelled';

export interface Dispute {
  id: string;
  agreement_id: string;
  opened_by: string;
  reason: string;
  evidence_urls: string[];
  status: DisputeStatus;
  resolver_wallet: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface DisputeResolution {
  id: string;
  dispute_id: string;
  resolved_by: string;
  payer_percentage: number;
  payee_percentage: number;
  resolution_notes: string;
  created_at: string;
}

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';

export interface DisputeProposal {
  id: string;
  dispute_id: string;
  proposed_by: string;
  payer_percentage: number;
  payee_percentage: number;
  notes: string;
  status: ProposalStatus;
  responded_by: string | null;
  created_at: string;
  updated_at: string;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Live `disputes` is the 004 schema (`opened_by_wallet`, `escrow_contract_id`). */
function toPublicDispute(row: Record<string, unknown>): Dispute {
  const evidence = row.evidence_urls;
  const urls = Array.isArray(evidence)
    ? evidence.filter((item): item is string => typeof item === 'string')
    : typeof row.evidence_url === 'string' && row.evidence_url
      ? [row.evidence_url]
      : [];
  const createdAt = asText(row.created_at);
  return {
    id: asText(row.id),
    agreement_id: asText(row.agreement_id),
    opened_by: asText(row.opened_by) || asText(row.opened_by_wallet),
    reason: asText(row.reason),
    evidence_urls: urls,
    status: row.status as DisputeStatus,
    resolver_wallet: asText(row.resolver_wallet) || null,
    created_at: createdAt,
    updated_at: asText(row.updated_at) || createdAt,
    resolved_at: asText(row.resolved_at) || null,
  };
}

@Injectable()
export class DisputesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly agreements: AgreementsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly activity: AgreementActivityService,
  ) {}

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

  private async assertActorWallet(userId: string, actorWallet: string) {
    const w = await this.walletForUserId(userId);
    if (!w || w !== actorWallet) {
      throw new ForbiddenException('Wallet does not match authenticated user');
    }
  }

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

  async openDispute(userId: string, dto: OpenDisputeDto) {
    await this.assertCanAccessAgreement(userId, dto.agreement_id);
    await this.assertActorWallet(userId, dto.opened_by);

    const { data: existingDispute } = await this.supabase
      .getClient()
      .from('disputes')
      .select('*')
      .eq('agreement_id', dto.agreement_id)
      .in('status', ['open', 'under_review'])
      .maybeSingle();

    if (existingDispute) {
      return { dispute: toPublicDispute(existingDispute as Record<string, unknown>), error: null };
    }

    const { data: agreementRow } = await this.supabase
      .getClient()
      .from('agreements')
      .select('status, contract_id, escrow_contract_id')
      .eq('id', dto.agreement_id)
      .maybeSingle();
    const agr = agreementRow as {
      status?: string;
      contract_id?: string | null;
      escrow_contract_id?: string | null;
    } | null;
    const alreadyDisputed = agr?.status === 'disputed';
    const escrowContractId = agr?.contract_id || agr?.escrow_contract_id || '';

    // Live table (004): opened_by_wallet + escrow_contract_id, no opened_by / evidence_urls.
    const insert: Record<string, unknown> = {
      agreement_id: dto.agreement_id,
      opened_by_wallet: dto.opened_by,
      escrow_contract_id: escrowContractId,
      reason: dto.reason,
      status: 'open',
    };

    const { data: dispute, error } = await this.supabase
      .getClient()
      .from('disputes')
      .insert(insert)
      .select()
      .single();

    if (error) {
      return { dispute: null, error: error.message };
    }

    let fromStatus: string | null = agr?.status ?? null;
    if (!alreadyDisputed) {
      const statusResult = await this.agreements.applyStatusChange(
        dto.agreement_id,
        dto.opened_by,
        'disputed',
        {
          enforceTransition: true,
          activityDetails: { dispute_id: dispute.id, reason: dto.reason, source: 'dispute' },
        },
      );
      if (!statusResult.success) {
        throw new BadRequestException({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            details: [
              {
                field: 'status',
                code: 'INVALID_TRANSITION',
                message: statusResult.error || 'Invalid status transition',
              },
            ],
          },
        });
      }
      fromStatus = statusResult.fromStatus ?? fromStatus;
    }

    await this.activity.logActivity(
      dto.agreement_id,
      dto.opened_by,
      'dispute_opened',
      { dispute_id: dispute.id, reason: dto.reason },
      { previousState: fromStatus, newState: 'disputed' },
    );

    this.eventEmitter.emit(AGREEMENT_EVENTS.DISPUTE_OPENED, {
      disputeId: dispute.id,
      agreementId: dto.agreement_id,
      openedByWallet: dto.opened_by,
      reason: dto.reason,
    });

    return { dispute: toPublicDispute(dispute as Record<string, unknown>), error: null };
  }

  async assignResolver(userId: string, disputeId: string, dto: AssignResolverDto) {
    const { data: dispute, error: fetchError } = await this.supabase
      .getClient()
      .from('disputes')
      .select('agreement_id, status')
      .eq('id', disputeId)
      .maybeSingle();

    if (fetchError || !dispute) {
      throw new NotFoundException('Dispute not found');
    }

    await this.assertCanAccessAgreement(userId, dispute.agreement_id);

    if (dispute.status !== 'open') {
      throw new BadRequestException('Can only assign resolver to open disputes');
    }

    const { error } = await this.supabase
      .getClient()
      .from('disputes')
      .update({
        resolver_wallet: dto.resolver_wallet,
        status: 'under_review',
      })
      .eq('id', disputeId);

    if (error) {
      return { success: false, error: error.message };
    }

    await this.activity.logActivity(
      dispute.agreement_id,
      dto.resolver_wallet,
      'dispute_resolver_assigned',
      {
        dispute_id: disputeId,
        resolver_wallet: dto.resolver_wallet,
      },
    );

    return { success: true, error: null };
  }

  async resolveDispute(userId: string, disputeId: string, dto: ResolveDisputeDto) {
    await this.assertActorWallet(userId, dto.resolved_by);

    // Validate percentages
    if (dto.payer_percentage + dto.payee_percentage !== 100) {
      throw new BadRequestException('Percentages must sum to 100%');
    }

    const { data: dispute, error: fetchError } = await this.supabase
      .getClient()
      .from('disputes')
      .select('id, agreement_id, status, resolver_wallet')
      .eq('id', disputeId)
      .maybeSingle();

    if (fetchError || !dispute) {
      throw new NotFoundException('Dispute not found');
    }

    if (dispute.status === 'resolved') {
      throw new BadRequestException('Dispute is already resolved');
    }

    if (!dispute.resolver_wallet || dispute.resolver_wallet !== dto.resolved_by) {
      throw new ForbiddenException('Only the assigned resolver can resolve this dispute');
    }

    // Create resolution
    const { data: resolution, error: resError } = await this.supabase
      .getClient()
      .from('dispute_resolutions')
      .insert({
        dispute_id: disputeId,
        resolved_by: dto.resolved_by,
        payer_percentage: dto.payer_percentage,
        payee_percentage: dto.payee_percentage,
        resolution_notes: dto.resolution_notes || '',
      })
      .select()
      .single();

    if (resError) {
      return { resolution: null, error: resError.message };
    }

    // Update dispute status
    await this.supabase
      .getClient()
      .from('disputes')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', disputeId);

    // Shared side-effect path for Agreement status → resolved
    const statusResult = await this.agreements.applyStatusChange(
      dispute.agreement_id,
      dto.resolved_by,
      'resolved',
      {
        enforceTransition: true,
        activityDetails: {
          dispute_id: disputeId,
          payer_percentage: dto.payer_percentage,
          payee_percentage: dto.payee_percentage,
          source: 'dispute',
        },
      },
    );
    if (!statusResult.success) {
      return { resolution: null, error: statusResult.error || 'Failed to mark agreement resolved' };
    }

    await this.activity.logActivity(
      dispute.agreement_id,
      dto.resolved_by,
      'dispute_resolved',
      {
        dispute_id: disputeId,
        payer_percentage: dto.payer_percentage,
        payee_percentage: dto.payee_percentage,
        resolution_notes: dto.resolution_notes,
      },
      { previousState: statusResult.fromStatus ?? 'disputed', newState: 'resolved' },
    );

    this.eventEmitter.emit(AGREEMENT_EVENTS.DISPUTE_RESOLVED, {
      disputeId,
      agreementId: dispute.agreement_id,
      resolvedByWallet: dto.resolved_by,
      payerPercentage: dto.payer_percentage,
      payeePercentage: dto.payee_percentage,
      resolutionNotes: dto.resolution_notes || '',
    });

    return { resolution: resolution as DisputeResolution, error: null };
  }

  async cancelDispute(userId: string, disputeId: string, dto: CancelDisputeDto) {
    await this.assertActorWallet(userId, dto.cancelled_by);

    const { data: dispute, error: fetchError } = await this.supabase
      .getClient()
      .from('disputes')
      .select('agreement_id, opened_by_wallet, status')
      .eq('id', disputeId)
      .maybeSingle();

    if (fetchError || !dispute) {
      throw new NotFoundException('Dispute not found');
    }

    const opener =
      (dispute as { opened_by?: string; opened_by_wallet?: string }).opened_by ??
      (dispute as { opened_by_wallet?: string }).opened_by_wallet;
    if (opener !== dto.cancelled_by) {
      throw new ForbiddenException('Only the dispute opener can cancel it');
    }

    if (dispute.status === 'resolved') {
      throw new BadRequestException('Cannot cancel a resolved dispute');
    }

    const { error } = await this.supabase
      .getClient()
      .from('disputes')
      .update({
        status: 'cancelled',
      })
      .eq('id', disputeId);

    if (error) {
      return { success: false, error: error.message };
    }

    // Validate the transition before delegating to applyStatusChange
    const { data: agreement } = await this.supabase
      .getClient()
      .from('agreements')
      .select('status')
      .eq('id', dispute.agreement_id)
      .single();
    const transitionValidation = validateTransition(agreement?.status as string, 'active');
    if (!transitionValidation.success) {
      throw new BadRequestException({ success: false, error: transitionValidation.error });
    }

    // Shared side-effect path: dispute cancelled → agreement back to active
    const statusResult = await this.agreements.applyStatusChange(
      dispute.agreement_id,
      dto.cancelled_by,
      'active',
      {
        activityDetails: { dispute_id: disputeId, source: 'dispute_cancel' },
      },
    );
    if (!statusResult.success) {
      return { success: false, error: statusResult.error || 'Failed to restore agreement status' };
    }

    await this.activity.logActivity(
      dispute.agreement_id,
      dto.cancelled_by,
      'dispute_cancelled',
      { dispute_id: disputeId },
      { previousState: statusResult.fromStatus ?? 'disputed', newState: 'active' },
    );

    return { success: true, error: null };
  }

  async getOpenDisputes(_userId: string) {
    // This endpoint is for dispute resolvers - they can see all open disputes
    const { data, error } = await this.supabase
      .getClient()
      .from('disputes')
      .select(
        `
        *,
        agreement:agreements (
          id,
          title,
          amount,
          contract_id
        )
      `,
      )
      .in('status', ['open', 'under_review'])
      .order('created_at', { ascending: false });

    if (error) {
      return { disputes: [], error: error.message };
    }

    return {
      disputes: ((data as Record<string, unknown>[]) || []).map((row) => ({
        ...toPublicDispute(row),
        agreement: row.agreement,
      })),
      error: null,
    };
  }

  async getDisputesByResolver(userId: string, resolverWallet: string) {
    await this.assertActorWallet(userId, resolverWallet);

    const { data, error } = await this.supabase
      .getClient()
      .from('disputes')
      .select(
        `
        *,
        agreement:agreements (
          id,
          title,
          amount,
          contract_id
        )
      `,
      )
      .eq('resolver_wallet', resolverWallet)
      .order('created_at', { ascending: false });

    if (error) {
      return { disputes: [], error: error.message };
    }

    return {
      disputes: ((data as Record<string, unknown>[]) || []).map((row) => ({
        ...toPublicDispute(row),
        agreement: row.agreement,
      })),
      error: null,
    };
  }

  async getDisputeById(userId: string, disputeId: string) {
    const { data: dispute, error: disputeError } = await this.supabase
      .getClient()
      .from('disputes')
      .select(
        `
        *,
        agreement:agreements (
          id,
          title,
          amount,
          contract_id
        )
      `,
      )
      .eq('id', disputeId)
      .maybeSingle();

    if (disputeError || !dispute) {
      throw new NotFoundException('Dispute not found');
    }

    // Check access
    await this.assertCanAccessAgreement(userId, dispute.agreement_id);

    // Get resolution if exists
    const { data: resolution } = await this.supabase
      .getClient()
      .from('dispute_resolutions')
      .select('*')
      .eq('dispute_id', disputeId)
      .maybeSingle();

    const { data: proposal } = await this.supabase
      .getClient()
      .from('dispute_proposals')
      .select('*')
      .eq('dispute_id', disputeId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      dispute: {
        ...toPublicDispute(dispute as Record<string, unknown>),
        agreement: (dispute as { agreement?: unknown }).agreement,
      },
      resolution: resolution as DisputeResolution | null,
      proposal: (proposal as DisputeProposal | null) ?? null,
      error: null,
    };
  }

  async proposeSettlement(userId: string, disputeId: string, dto: ProposeSettlementDto) {
    await this.assertActorWallet(userId, dto.proposed_by);
    if (dto.payer_percentage + dto.payee_percentage !== 100) {
      throw new BadRequestException('Percentages must sum to 100%');
    }

    const dispute = await this.requireOpenDispute(disputeId);
    await this.assertCanAccessAgreement(userId, dispute.agreement_id);

    await this.supabase
      .getClient()
      .from('dispute_proposals')
      .update({
        status: 'superseded',
        updated_at: new Date().toISOString(),
      })
      .eq('dispute_id', disputeId)
      .eq('status', 'pending');

    const { data: proposal, error } = await this.supabase
      .getClient()
      .from('dispute_proposals')
      .insert({
        dispute_id: disputeId,
        proposed_by: dto.proposed_by,
        payer_percentage: dto.payer_percentage,
        payee_percentage: dto.payee_percentage,
        notes: dto.notes ?? '',
        status: 'pending',
      })
      .select()
      .single();

    if (error || !proposal) {
      throw new BadRequestException(
        `Failed to record the proposal: ${error?.message ?? 'unknown'}`,
      );
    }

    this.eventEmitter.emit(AGREEMENT_EVENTS.DISPUTE_PROPOSAL, {
      agreementId: dispute.agreement_id,
      disputeId,
      proposedBy: dto.proposed_by,
      payerPercentage: dto.payer_percentage,
      payeePercentage: dto.payee_percentage,
    });

    return { proposal: proposal as DisputeProposal, error: null };
  }

  async acceptProposal(
    userId: string,
    disputeId: string,
    proposalId: string,
    dto: RespondProposalDto,
  ) {
    const proposal = await this.respondToProposal(userId, disputeId, proposalId, dto, 'accepted');

    this.eventEmitter.emit(AGREEMENT_EVENTS.DISPUTE_PROPOSAL_ACCEPTED, {
      agreementId: proposal.agreementId,
      disputeId,
      proposalId,
      acceptedBy: dto.actor_wallet,
      payerPercentage: proposal.row.payer_percentage,
      payeePercentage: proposal.row.payee_percentage,
    });

    return {
      proposal: proposal.row,
      next: 'settlement_pending' as const,
      error: null,
    };
  }

  async rejectProposal(
    userId: string,
    disputeId: string,
    proposalId: string,
    dto: RespondProposalDto,
  ) {
    const proposal = await this.respondToProposal(userId, disputeId, proposalId, dto, 'rejected');
    return { proposal: proposal.row, error: null };
  }

  private async requireOpenDispute(disputeId: string): Promise<Dispute> {
    const { data, error } = await this.supabase
      .getClient()
      .from('disputes')
      .select('*')
      .eq('id', disputeId)
      .maybeSingle();

    if (error || !data) throw new NotFoundException('Dispute not found');
    const dispute = toPublicDispute(data as Record<string, unknown>);
    if (dispute.status === 'resolved' || dispute.status === 'cancelled') {
      throw new BadRequestException('This dispute is already closed');
    }
    return dispute;
  }

  private async respondToProposal(
    userId: string,
    disputeId: string,
    proposalId: string,
    dto: RespondProposalDto,
    status: 'accepted' | 'rejected',
  ): Promise<{ row: DisputeProposal; agreementId: string }> {
    await this.assertActorWallet(userId, dto.actor_wallet);

    const dispute = await this.requireOpenDispute(disputeId);
    await this.assertCanAccessAgreement(userId, dispute.agreement_id);

    const { data, error } = await this.supabase
      .getClient()
      .from('dispute_proposals')
      .select('*')
      .eq('id', proposalId)
      .eq('dispute_id', disputeId)
      .maybeSingle();

    if (error || !data) throw new NotFoundException('Proposal not found');
    const row = data as DisputeProposal;
    if (row.status !== 'pending') {
      throw new BadRequestException('This proposal is no longer pending');
    }
    if (row.proposed_by === dto.actor_wallet) {
      throw new ForbiddenException('The other party has to respond to this proposal');
    }

    const { data: updated, error: updateError } = await this.supabase
      .getClient()
      .from('dispute_proposals')
      .update({
        status,
        responded_by: dto.actor_wallet,
        updated_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (updateError || !updated) {
      throw new BadRequestException('Could not update the proposal');
    }

    return { row: updated as DisputeProposal, agreementId: dispute.agreement_id };
  }

  async getDisputesByAgreement(userId: string, agreementId: string) {
    await this.assertCanAccessAgreement(userId, agreementId);

    const { data, error } = await this.supabase
      .getClient()
      .from('disputes')
      .select('*')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: false });

    if (error) {
      return { disputes: [], error: error.message };
    }

    return {
      disputes: ((data as Record<string, unknown>[]) || []).map((row) => toPublicDispute(row)),
      error: null,
    };
  }
}
