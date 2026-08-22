import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseService } from '../../supabase/supabase.service';
import { RetryQueueService } from '../../common/retry/retry-queue.service';
import { AgreementValidationService } from '../validation/agreement-validation.service';
import { relayToTrustless } from '../../internal-trustless/trustless-relay.helper';
import { AGREEMENT_EVENTS } from '../../common/events/agreement-events.constants';
import { normalizeMilestoneStatus } from '../../common/milestone-status';

// ── Types ──────────────────────────────────────────────────────────────────

/** Mirror of the TW escrow shape (inferred from helper endpoints). */
export interface TrustlessEscrow {
  id: string;
  status: string;
  sender: string;
  receiver: string;
  approver?: string;
  amount: string;
  asset: string;
  type: 'single-release' | 'multi-release';
  milestones?: Array<{
    description: string;
    amount: string;
    status: 'pending' | 'approved' | 'released';
  }>;
}

export type SyncDirection = 'thalos_to_tw' | 'tw_to_thalos' | 'already_in_sync';

export interface SyncResult {
  synced: boolean;
  direction?: SyncDirection;
  actions: string[];
  errors: string[];
}

export interface ReconcileResult {
  reconciled: boolean;
  divergence?: string;
  resolution?: string;
  actions: string[];
}

export interface ValidateContractResult {
  valid: boolean;
  escrow?: TrustlessEscrow;
  error?: string;
}

// ── Status mapping ─────────────────────────────────────────────────────────

/** Trustless Work escrow status → Thalos agreement status. */
const TW_TO_THALOS_STATUS: Record<string, string> = {
  created: 'pending',
  funded: 'funded',
  active: 'active',
  completed: 'completed',
  cancelled: 'cancelled',
  disputed: 'disputed',
};

/** Thalos agreement status → Trustless Work escrow status (informational). */
const THALOS_TO_TW_STATUS: Record<string, string> = {
  pending: 'created',
  funded: 'funded',
  active: 'active',
  completed: 'completed',
  cancelled: 'cancelled',
  disputed: 'disputed',
  // "in_review" and "resolved" are Thalos-only — no TW mapping.
};

// ── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class AgreementSyncService {
  private readonly logger = new Logger(AgreementSyncService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly validation: AgreementValidationService,
    private readonly retryQueue: RetryQueueService,
  ) {
    // Register handler so the retry queue can process sync jobs
    this.retryQueue.registerHandler('sync_agreement', async (job) => {
      const payload = job.payload as { agreementId: string };
      const result = await this.doSync(payload.agreementId);
      return {
        success: result.errors.length === 0,
        error: result.errors.join('; '),
      };
    });

    this.retryQueue.registerHandler('reconcile_agreement', async (job) => {
      const payload = job.payload as { agreementId: string };
      const result = await this.doReconcile(payload.agreementId);
      return {
        success: result.reconciled,
        error: result.actions.length === 0 ? 'Reconciliation did not change state' : undefined,
      };
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Validate that a contract_id exists on Trustless Work.
   * Used by linkContract to reject invalid contract_ids before persisting.
   */
  async validateContractOnTrustless(contractId: string): Promise<ValidateContractResult> {
    try {
      const escrow = await this.fetchTrustlessEscrow(contractId);
      if (!escrow) {
        return {
          valid: false,
          error: `Contract "${contractId}" not found on Trustless Work`,
        };
      }
      return { valid: true, escrow };
    } catch (err) {
      return {
        valid: false,
        error: `Could not validate contract on TW: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Sync a single agreement: compare Thalos ↔ TW state and push/pull changes.
   * Can be called synchronously (returns result) or via the retry queue.
   */
  async syncAgreement(
    agreementId: string,
    options?: { useRetryQueue?: boolean },
  ): Promise<SyncResult> {
    if (options?.useRetryQueue) {
      this.retryQueue.enqueue('sync_agreement', { agreementId });
      return {
        synced: false,
        actions: ['Enqueued sync job to retry queue'],
        errors: [],
      };
    }
    return this.doSync(agreementId);
  }

  /**
   * Reconcile a Thalos agreement against its Trustless Work escrow.
   * Detects divergences and corrects them.
   */
  async reconcileAgreement(
    agreementId: string,
    options?: { useRetryQueue?: boolean },
  ): Promise<ReconcileResult> {
    if (options?.useRetryQueue) {
      this.retryQueue.enqueue('reconcile_agreement', { agreementId });
      return {
        reconciled: false,
        actions: ['Enqueued reconcile job to retry queue'],
      };
    }
    return this.doReconcile(agreementId);
  }

  /**
   * Log a status transition for audit purposes and emit appropriate events.
   * This is called AFTER the transition has been validated and applied to Thalos.
   * TW state mutations (deploy/fund/complete) require user-signed XDR client-side.
   */
  async syncStatusTransition(
    agreementId: string,
    fromStatus: string,
    toStatus: string,
  ): Promise<SyncResult> {
    const actions: string[] = [];
    const errors: string[] = [];

    // 1. Validate transition (belt-and-suspenders; AgreementsService also validates)
    const validation = this.validation.validateTransition(fromStatus, toStatus);
    if (!validation.valid) {
      errors.push(validation.reason);
      await this.logSyncActivity(agreementId, 'transition_rejected', {
        from: fromStatus,
        to: toStatus,
        reason: validation.reason,
      });
      return { synced: false, actions, errors };
    }

    actions.push(`Transition "${fromStatus}" → "${toStatus}" validated`);

    // 2. Fetch agreement data
    const { data: agreement } = await this.supabase
      .getClient()
      .from('agreements')
      .select('*')
      .eq('id', agreementId)
      .single();

    if (!agreement) {
      errors.push('Agreement not found');
      return { synced: false, actions, errors };
    }

    // 3. Log the intended TW action (actual mutation requires client-side XDR)
    if (agreement.contract_id) {
      const twTarget = THALOS_TO_TW_STATUS[toStatus];
      if (twTarget) {
        this.logger.log(
          `Synced status "${toStatus}" (TW: "${twTarget}") for contract ${agreement.contract_id} — client must sign XDR to finalize on TW`,
        );
        actions.push(
          `Status "${toStatus}" logged for TW sync — user must sign transaction on client`,
        );
      }
    }

    // 4. Emit appropriate lifecycle events
    if (toStatus === 'funded') {
      this.eventEmitter.emit(AGREEMENT_EVENTS.FUNDED, {
        agreementId,
        title: agreement.title,
        amount: agreement.amount,
        asset: agreement.asset ?? 'USDC',
        fundedByWallet: agreement.created_by,
      });
    } else if (toStatus === 'completed' || toStatus === 'resolved') {
      this.eventEmitter.emit(AGREEMENT_EVENTS.COMPLETED, {
        agreementId,
        title: agreement.title,
        totalAmount: agreement.amount,
        asset: agreement.asset ?? 'USDC',
        completedAt: new Date().toISOString(),
      });
    }

    // 5. Log sync activity
    await this.logSyncActivity(agreementId, 'transition_applied', {
      from: fromStatus,
      to: toStatus,
      contractId: agreement.contract_id,
    });

    return { synced: true, direction: 'thalos_to_tw', actions, errors };
  }

  /**
   * Fetch the current Trustless Work escrow state for a given contract_id.
   * Tries the escrow-specific endpoint first, then falls back to helper endpoints.
   * Returns null if the contract doesn't exist on TW or isn't reachable.
   */
  async fetchTrustlessEscrow(contractId: string): Promise<TrustlessEscrow | null> {
    try {
      // Try direct escrow lookup first (standard REST pattern)
      const directResult = await relayToTrustless(
        'GET',
        `escrow/${encodeURIComponent(contractId)}`,
      );

      if (directResult.status >= 200 && directResult.status < 300 && directResult.data) {
        const data = directResult.data as TrustlessEscrow | TrustlessEscrow[];
        return Array.isArray(data)
          ? (data.find((e) => e.id === contractId) ?? data[0] ?? null)
          : data;
      }

      // Fallback: search by signer
      this.logger.warn(
        `Direct escrow lookup failed for ${contractId} (${directResult.status}), trying helper fallback`,
      );

      const fallbackResult = await relayToTrustless('GET', 'helper/get-escrows-by-signer', {
        signer: contractId,
      });

      if (fallbackResult.status >= 400) {
        this.logger.warn(
          `TW helper returned ${fallbackResult.status} for contract ${contractId}: ${JSON.stringify(fallbackResult.data)}`,
        );
        return null;
      }

      const escrows = fallbackResult.data as TrustlessEscrow[] | TrustlessEscrow | null;
      if (!escrows) return null;

      if (Array.isArray(escrows)) {
        return escrows.find((e) => e.id === contractId) ?? escrows[0] ?? null;
      }
      return escrows;
    } catch (err) {
      this.logger.error(
        `Failed to fetch escrow ${contractId} from TW: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async doSync(agreementId: string): Promise<SyncResult> {
    const actions: string[] = [];
    const errors: string[] = [];

    // 1. Fetch Thalos agreement
    const { data: agreement, error: fetchErr } = await this.supabase
      .getClient()
      .from('agreements')
      .select('*')
      .eq('id', agreementId)
      .single();

    if (fetchErr || !agreement) {
      errors.push(fetchErr?.message ?? 'Agreement not found');
      return { synced: false, actions, errors };
    }

    if (!agreement.contract_id) {
      actions.push('No contract_id linked — skipping TW sync');
      return { synced: true, actions, errors };
    }

    // 2. Fetch TW escrow
    const escrow = await this.fetchTrustlessEscrow(agreement.contract_id);
    if (!escrow) {
      errors.push('Could not fetch escrow from Trustless Work');
      await this.logSyncActivity(agreementId, 'fetch_failed', {
        contractId: agreement.contract_id,
      });
      return { synced: false, actions, errors };
    }

    actions.push(`Fetched escrow ${agreement.contract_id} from TW (status: ${escrow.status})`);

    // 3. Map TW status → Thalos status
    const twMappedStatus = TW_TO_THALOS_STATUS[escrow.status] ?? escrow.status;
    const currentStatus = (agreement.status as string) ?? 'pending';

    // 4. Compare and decide sync direction
    if (currentStatus === twMappedStatus) {
      actions.push('Statuses match — already in sync');
      await this.logSyncActivity(agreementId, 'already_in_sync', {
        status: currentStatus,
        contractId: agreement.contract_id,
      });
      return { synced: true, direction: 'already_in_sync', actions, errors };
    }

    // Determine which side is ahead using lifecycle ordering
    const statusOrder = ['pending', 'funded', 'active', 'in_review', 'completed'];
    const twIdx = statusOrder.indexOf(twMappedStatus);
    const thIdx = statusOrder.indexOf(currentStatus);

    let direction: SyncDirection;
    if (twIdx > thIdx) {
      // TW is further along → pull into Thalos
      direction = 'tw_to_thalos';
    } else if (thIdx > twIdx) {
      // Thalos is further along → log that client-side action is needed
      direction = 'thalos_to_tw';
    } else {
      // Same position but different string → prefer TW state
      direction = 'tw_to_thalos';
    }

    actions.push(
      `Sync direction: ${direction} (Thalos: "${currentStatus}", TW mapped: "${twMappedStatus}")`,
    );

    if (direction === 'tw_to_thalos') {
      // Pull TW state into Thalos
      const { error: updateErr } = await this.supabase
        .getClient()
        .from('agreements')
        .update({
          status: twMappedStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', agreementId);

      if (updateErr) {
        errors.push(`Failed to update Thalos status: ${updateErr.message}`);
        return { synced: false, direction, actions, errors };
      }

      actions.push(`Status updated in Thalos: "${currentStatus}" → "${twMappedStatus}"`);

      // Sync participants if available
      if (escrow.sender || escrow.receiver) {
        await this.syncParticipants(agreementId, escrow);
        actions.push('Participants synced from TW');
      }

      await this.logSyncActivity(agreementId, 'pulled_from_tw', {
        fromStatus: currentStatus,
        toStatus: twMappedStatus,
        twRawStatus: escrow.status,
        contractId: agreement.contract_id,
      });
    } else {
      // Thalos is ahead — log it. The actual TW mutation (deploy/fund/complete)
      // must be initiated client-side with user-signed XDR.
      actions.push(
        `Thalos status "${currentStatus}" is ahead of TW "${twMappedStatus}" — deploy/fund/complete on TW client-side`,
      );
      await this.logSyncActivity(agreementId, 'push_pending', {
        fromStatus: currentStatus,
        toStatus: twMappedStatus,
        contractId: agreement.contract_id,
      });
    }

    return { synced: errors.length === 0, direction, actions, errors };
  }

  private async doReconcile(agreementId: string): Promise<ReconcileResult> {
    const syncResult = await this.doSync(agreementId);

    if (syncResult.direction === 'already_in_sync') {
      return {
        reconciled: true,
        actions: syncResult.actions,
      };
    }

    if (!syncResult.synced && syncResult.errors.length > 0) {
      return {
        reconciled: false,
        divergence: syncResult.errors.join('; '),
        resolution: 'Could not reconcile — errors during sync',
        actions: syncResult.actions,
      };
    }

    // Additional reconciliation: check participants, milestones, etc.
    const actions = [...syncResult.actions];
    const { data: agreement } = await this.supabase
      .getClient()
      .from('agreements')
      .select('contract_id, status, milestones')
      .eq('id', agreementId)
      .single();

    if (agreement?.contract_id) {
      const escrow = await this.fetchTrustlessEscrow(agreement.contract_id);
      if (escrow) {
        // Reconcile milestones
        if (escrow.milestones && agreement.milestones) {
          const thalosMilestones = agreement.milestones as Array<{
            description: string;
            amount: string;
            status: string;
          }>;

          for (let i = 0; i < Math.min(thalosMilestones.length, escrow.milestones.length); i++) {
            const twStatus = normalizeMilestoneStatus(escrow.milestones[i].status);
            if (!twStatus) {
              this.logger.warn(
                `Skipping unknown TW milestone status "${escrow.milestones[i].status}" ` +
                  `for agreement ${agreementId}`,
              );
              continue;
            }
            const previousStatus = thalosMilestones[i].status;
            if (previousStatus !== twStatus) {
              thalosMilestones[i].status = twStatus;
              actions.push(
                `Reconciled milestone[${i}] status: "${previousStatus}" → "${twStatus}"`,
              );
            }
          }

          await this.supabase
            .getClient()
            .from('agreements')
            .update({
              milestones: thalosMilestones,
              updated_at: new Date().toISOString(),
            })
            .eq('id', agreementId);
        }

        await this.logSyncActivity(agreementId, 'reconcile_completed', {
          thalosStatus: agreement.status,
          twStatus: escrow.status,
          milestonesReconciled: escrow.milestones?.length ?? 0,
        });
      }
    }

    return {
      reconciled: actions.length > 0,
      divergence: syncResult.direction ? `Status divergence: Thalos vs TW` : undefined,
      resolution: 'Divergence corrected',
      actions,
    };
  }

  /** Sync participants from a TW escrow into Thalos. */
  private async syncParticipants(agreementId: string, escrow: TrustlessEscrow): Promise<void> {
    const existingRoles = new Set<string>();

    const { data: existing } = await this.supabase
      .getClient()
      .from('agreement_participants')
      .select('wallet_address, role')
      .eq('agreement_id', agreementId);

    if (existing) {
      for (const p of existing) {
        existingRoles.add(`${p.wallet_address}:${p.role}`);
      }
    }

    const toInsert: Array<{
      agreement_id: string;
      wallet_address: string;
      role: string;
    }> = [];

    if (escrow.sender && !existingRoles.has(`${escrow.sender}:sender`)) {
      toInsert.push({
        agreement_id: agreementId,
        wallet_address: escrow.sender,
        role: 'sender',
      });
    }
    if (escrow.receiver && !existingRoles.has(`${escrow.receiver}:receiver`)) {
      toInsert.push({
        agreement_id: agreementId,
        wallet_address: escrow.receiver,
        role: 'receiver',
      });
    }
    if (escrow.approver && !existingRoles.has(`${escrow.approver}:approver`)) {
      toInsert.push({
        agreement_id: agreementId,
        wallet_address: escrow.approver,
        role: 'approver',
      });
    }

    if (toInsert.length > 0) {
      await this.supabase.getClient().from('agreement_participants').insert(toInsert);
    }
  }

  /** Log a sync event to the activity log. */
  private async logSyncActivity(
    agreementId: string,
    action: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.supabase
        .getClient()
        .from('agreement_activity')
        .insert({
          agreement_id: agreementId,
          actor_wallet: 'SYNC_ENGINE',
          action: `sync_${action}`,
          details: {
            ...details,
            timestamp: new Date().toISOString(),
          },
        });
    } catch (e) {
      this.logger.error(`Failed to log sync activity for ${agreementId}`, e);
    }
  }
}
