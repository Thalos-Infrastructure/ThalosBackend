import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseService } from '../supabase/supabase.service';
import { AgreementsBackendClient } from './agreements-backend.client';
import { CreateAgreementDto } from './dto/create-agreement.dto';
import { LinkContractDto } from './dto/link-contract.dto';
import { UpdateAgreementStatusDto } from './dto/update-status.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import {
  canTransition,
  invalidTransitionMessage,
  milestonesSatisfyCompletion,
} from './agreement-lifecycle';
import { AgreementActivityService } from './agreement-activity.service';

@Injectable()
export class AgreementsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly backendClient: AgreementsBackendClient,
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
    if (!w) {
      throw new ForbiddenException(
        'No hay wallet en auth_users para este usuario (wallet_public_key vacío o usuario no encontrado). Revisá Supabase y que Nest use el mismo proyecto (SUPABASE_URL).',
      );
    }
    if (w !== actorWallet) {
      throw new ForbiddenException(
        'created_by debe ser exactamente auth_users.wallet_public_key del usuario del JWT (misma cadena G...).',
      );
    }
  }

  /** Perfil opcional vinculado por wallet (tabla profiles). */
  private async profileIdByWallet(wallet: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('id')
      .eq('wallet_address', wallet)
      .maybeSingle();
    if (error || !data?.id) return null;
    return data.id as string;
  }

  private async assertCanAccessAgreement(userId: string, agreementId: string): Promise<void> {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) throw new ForbiddenException('No wallet on profile');

    // Get agreement via backend client to check access
    const result = await this.backendClient.getAgreement(agreementId, wallet);
    if (!result.success || !result.data?.agreement) {
      throw new NotFoundException('Agreement not found');
    }

    const agreement = result.data.agreement;
    const createdBy = agreement.created_by;
    if (createdBy === wallet || createdBy === userId) return;

    // Check if wallet is a participant
    const participants = result.data.participants ?? [];
    const isParticipant = participants.some((p) => p.wallet_address === wallet);
    if (!isParticipant) {
      throw new ForbiddenException('Not a participant of this agreement');
    }
  }

  async create(userId: string, dto: CreateAgreementDto) {
    await this.assertActorWallet(userId, dto.created_by);

    const createdByProfileId = await this.profileIdByWallet(dto.created_by);

    const backendReq = {
      contract_id: dto.contract_id ?? null,
      title: dto.title,
      description: dto.description ?? null,
      amount: dto.amount,
      asset: dto.asset ?? 'USDC',
      agreement_type: dto.agreement_type ?? 'single',
      milestones: dto.milestones ?? [],
      metadata: dto.metadata ?? {},
      created_by: dto.created_by,
      created_by_profile_id: createdByProfileId ?? undefined,
      participants: dto.participants.map((p) => ({
        wallet_address: p.wallet_address,
        role: p.role,
        profile_id: p.profile_id,
      })),
    };

    if (participantsError) {
      await this.supabase.getClient().from('agreements').delete().eq('id', agreement.id);
      throw new BadRequestException(
        `Failed to create agreement participants: ${participantsError.message}`,
      );
    }

    await this.activity.logActivity(agreement.id, dto.created_by, 'created', {
      title: dto.title,
      amount: dto.amount,
    });

    const createdMilestones = (agreement.milestones ?? []) as Array<{
      description?: string;
      status?: string;
    }>;
    for (let index = 0; index < createdMilestones.length; index++) {
      const milestone = createdMilestones[index];
      await this.activity.logActivity(
        agreement.id,
        dto.created_by,
        'milestone_created',
        {
          milestone_index: index,
          milestone_description: milestone.description,
        },
        { previousState: null, newState: milestone.status ?? 'pending' },
      );
    }

    this.eventEmitter.emit(AGREEMENT_EVENTS.CREATED, {
      agreementId: agreement.id,
      title: agreement.title,
      description: agreement.description,
      amount: agreement.amount,
      asset: agreement.asset ?? 'USDC',
      createdByWallet: agreement.created_by,
      participantWallets: dto.participants.map((p) => p.wallet_address),
    });

    return { agreement, error: null };
  }

  async linkContract(userId: string, agreementId: string, dto: LinkContractDto) {
    await this.assertCanAccessAgreement(userId, agreementId);
    await this.assertActorWallet(userId, dto.actor_wallet);

    const result = await this.backendClient.linkContract(
      agreementId,
      dto.contract_id,
      dto.actor_wallet,
      dto.actor_wallet,
    );

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to link contract' };
    }

    await this.activity.logActivity(agreementId, dto.actor_wallet, 'contract_linked', {
      contract_id: dto.contract_id,
    });
    return { success: true, error: null };
  }

  async updateStatus(userId: string, agreementId: string, dto: UpdateAgreementStatusDto) {
    await this.assertCanAccessAgreement(userId, agreementId);
    await this.assertActorWallet(userId, dto.actor_wallet);

    // Get current agreement to validate transition
    const getResult = await this.backendClient.getAgreement(agreementId, dto.actor_wallet);
    if (!getResult.success || !getResult.data?.agreement) {
      return { success: false, error: 'Agreement not found' };
    }

    const current = getResult.data.agreement;
    const fromStatus = current.status;

    if (!canTransition(fromStatus, dto.status)) {
      throw new BadRequestException(invalidTransitionMessage(fromStatus, dto.status));
    }

    if (dto.status === 'completed' && !milestonesSatisfyCompletion(current.milestones)) {
      throw new BadRequestException(
        'All milestones must be approved or released before the agreement can be completed',
      );
    }

    const updateResult = await this.backendClient.updateAgreementStatus(
      agreementId,
      {
        status: dto.status,
        actor_wallet: dto.actor_wallet,
      },
      dto.actor_wallet,
    );

    await this.activity.logActivity(
      agreementId,
      dto.actor_wallet,
      `status_changed_to_${dto.status}`,
      {
        status: dto.status,
        from: fromStatus,
        to: dto.status,
      },
      { previousState: fromStatus, newState: dto.status },
    );

    if (dto.status === 'funded') {
      this.eventEmitter.emit(AGREEMENT_EVENTS.FUNDED, {
        agreementId,
        title: current.title,
        amount: current.amount,
        asset: current.asset ?? 'USDC',
        fundedByWallet: dto.actor_wallet,
      });
    } else if (dto.status === 'completed' || dto.status === 'resolved') {
      this.eventEmitter.emit(AGREEMENT_EVENTS.COMPLETED, {
        agreementId,
        title: current.title,
        totalAmount: current.amount,
        asset: current.asset ?? 'USDC',
        completedAt: new Date().toISOString(),
      });
    }

    return { success: true, error: null };
  }

  async updateMilestone(userId: string, agreementId: string, dto: UpdateMilestoneDto) {
    await this.assertCanAccessAgreement(userId, agreementId);
    await this.assertActorWallet(userId, dto.actor_wallet);

    const { data: agreement, error: fetchError } = await this.supabase
      .getClient()
      .from('agreements')
      .select('milestones')
      .eq('id', agreementId)
      .single();

    if (fetchError || !agreement) {
      return { success: false, error: fetchError?.message || 'Not found' };
    }

    const milestones = agreement.milestones as Array<{
      description: string;
      amount: string;
      status: string;
      evidence_description?: string;
      evidence_urls?: string[];
      evidence_submitted_at?: string;
    }>;
    if (dto.milestone_index < 0 || dto.milestone_index >= milestones.length) {
      return { success: false, error: 'Invalid milestone index' };
    }

    const milestone = milestones[dto.milestone_index];
    const emitsEvidence = dto.evidence_description !== undefined || dto.evidence_urls !== undefined;
    const previousMilestoneStatus = milestone.status;

    milestone.status = dto.status;

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to update milestone' };
    }

    const { error: updateError } = await this.supabase
      .getClient()
      .from('agreements')
      .update({
        milestones,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agreementId);

    if (updateError) return { success: false, error: updateError.message };

    await this.activity.logActivity(
      agreementId,
      dto.actor_wallet,
      `milestone_${dto.status}`,
      {
        milestone_index: dto.milestone_index,
        milestone_description: milestones[dto.milestone_index].description,
        from: previousMilestoneStatus,
        to: dto.status,
      },
      { previousState: previousMilestoneStatus, newState: dto.status },
    );
    return { success: true, error: null };
  }

  async listByWallet(userId: string, wallet: string) {
    await this.assertActorWallet(userId, wallet);

    const result = await this.backendClient.listAgreementsByWallet(wallet, wallet);
    if (!result.success) {
      return { agreements: [], error: result.error || 'Failed to list agreements' };
    }

    return { agreements: result.data?.agreements ?? [], error: null };
  }

  async getById(userId: string, agreementId: string) {
    await this.assertCanAccessAgreement(userId, agreementId);

    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      return { agreement: null, participants: [], error: 'No wallet found' };
    }

    const result = await this.backendClient.getAgreement(agreementId, wallet);
    if (!result.success) {
      return { agreement: null, participants: [], error: result.error || 'Agreement not found' };
    }

    return {
      agreement: result.data?.agreement ?? null,
      participants: result.data?.participants ?? [],
      error: null,
    };
  }

  async getByContractId(userId: string, contractId: string) {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      return { agreement: null, error: 'No wallet found' };
    }

    const result = await this.backendClient.getAgreementByContractId(contractId, wallet);
    if (!result.success || !result.data?.agreement) {
      return {
        agreement: null,
        error:
          result.error ||
          'Ningún acuerdo tiene contract_id igual a este valor (copiá el texto exacto de la columna contract_id).',
      };
    }

    const agreement = result.data.agreement;
    await this.assertCanAccessAgreement(userId, agreement.id);
    return { agreement, error: null };
  }

  /**
   * Shared side-effect path for Agreement status changes.
   * Used by DisputesService (and any other internal caller) so dispute-driven
   * updates emit the same activity log shape and domain events as updateStatus.
   */
  async applyStatusChange(
    agreementId: string,
    actorWallet: string,
    toStatus: string,
    options: {
      fromStatus?: string;
      enforceTransition?: boolean;
      activityDetails?: Record<string, unknown>;
    } = {},
  ): Promise<{ success: boolean; error: string | null; fromStatus?: string }> {
    const { data: current, error: fetchError } = await this.supabase
      .getClient()
      .from('agreements')
      .select('status, title, amount, asset')
      .eq('id', agreementId)
      .single();

    if (fetchError || !current) {
      return { success: false, error: fetchError?.message || 'Agreement not found' };
    }

    const fromStatus = options.fromStatus ?? (current.status as string);

    if (options.enforceTransition && !canTransition(fromStatus, toStatus)) {
      return { success: false, error: invalidTransitionMessage(fromStatus, toStatus) };
    }

    const updates: Record<string, unknown> = {
      status: toStatus,
      updated_at: new Date().toISOString(),
    };
    if (toStatus === 'funded') {
      updates.funded_at = new Date().toISOString();
    } else if (toStatus === 'completed' || toStatus === 'resolved') {
      updates.completed_at = new Date().toISOString();
    }

    const { error } = await this.supabase
      .getClient()
      .from('agreements')
      .update(updates)
      .eq('id', agreementId);

    if (error) return { success: false, error: error.message };

    await this.activity.logActivity(
      agreementId,
      actorWallet,
      `status_changed_to_${toStatus}`,
      {
        status: toStatus,
        from: fromStatus,
        to: toStatus,
        ...(options.activityDetails ?? {}),
      },
      { previousState: fromStatus, newState: toStatus },
    );

    if (toStatus === 'funded') {
      this.eventEmitter.emit(AGREEMENT_EVENTS.FUNDED, {
        agreementId,
        title: current.title,
        amount: current.amount,
        asset: current.asset ?? 'USDC',
        fundedByWallet: actorWallet,
      });
    } else if (toStatus === 'completed' || toStatus === 'resolved') {
      this.eventEmitter.emit(AGREEMENT_EVENTS.COMPLETED, {
        agreementId,
        title: current.title,
        totalAmount: current.amount,
        asset: current.asset ?? 'USDC',
        completedAt: new Date().toISOString(),
      });
    }

    return { success: true, error: null, fromStatus };
  }

  async getActivity(userId: string, agreementId: string) {
    await this.assertCanAccessAgreement(userId, agreementId);

    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      return { activities: [], error: 'No wallet found' };
    }

    const result = await this.backendClient.getAgreementActivity(agreementId, wallet);
    if (!result.success) {
      return { activities: [], error: result.error || 'Failed to get activity' };
    }

    return { activities: result.data?.activities ?? [], error: null };
  }
}
