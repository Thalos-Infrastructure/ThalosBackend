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

@Injectable()
export class AgreementsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly backendClient: AgreementsBackendClient,
    private readonly eventEmitter: EventEmitter2,
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

    const result = await this.backendClient.createAgreement(dto.created_by, backendReq);
    if (!result.success || !result.data?.agreement) {
      return { agreement: null, error: result.error || 'Failed to create agreement' };
    }

    const agreement = result.data.agreement;

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

    if (!updateResult.success) {
      return { success: false, error: updateResult.error || 'Failed to update status' };
    }

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

    const result = await this.backendClient.updateMilestone(
      agreementId,
      {
        milestone_index: dto.milestone_index,
        status: dto.status,
        actor_wallet: dto.actor_wallet,
        evidence_description: dto.evidence_description,
        evidence_urls: dto.evidence_urls,
      },
      dto.actor_wallet,
    );

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to update milestone' };
    }

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

  private async logActivity(
    agreementId: string,
    actorWallet: string,
    action: string,
    details: Record<string, unknown> = {},
  ) {
    try {
      await this.backendClient.logActivity(
        {
          agreement_id: agreementId,
          actor_wallet: actorWallet,
          action,
          details,
        },
        actorWallet,
      );
    } catch (e) {
      console.error('logAgreementActivity', e);
    }
  }
}
