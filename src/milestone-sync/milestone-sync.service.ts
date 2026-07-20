import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import {
  approveMilestone,
  changeMilestoneStatus,
} from '../internal-trustless/escrow-write.helper';
import { AgreementEventName } from '../events/agreement-events';
import {
  MILESTONE_SYNC_EVENTS,
  THALOS_TO_TW_STATUS,
  TW_TO_THALOS_STATUS,
} from './milestone-sync.constants';
import { MilestoneSyncConflictService } from './milestone-sync-conflict.service';
import { MilestoneSyncRetryService } from './milestone-sync-retry.service';
import type {
  ConflictDetails,
  MilestoneRecord,
  SyncMilestoneContext,
  SyncResult,
} from './dto/sync-milestone.dto';

@Injectable()
export class MilestoneSyncService {
  private readonly logger = new Logger(MilestoneSyncService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly conflictService: MilestoneSyncConflictService,
    private readonly retryService: MilestoneSyncRetryService,
  ) {}

  /**
   * Builds a deterministic idempotency key for a Thalos→TW sync operation.
   * Floored to 5-minute buckets to deduplicate rapid re-fires while
   * allowing legitimate retries after the window expires.
   */
  static buildIdempotencyKey(
    agreementId: string,
    milestoneIndex: number,
    thalosStatus: string,
  ): string {
    const bucket = Math.floor(Date.now() / 300_000);
    return crypto
      .createHash('sha256')
      .update(`${agreementId}:${milestoneIndex}:${thalosStatus}:${bucket}`)
      .digest('hex');
  }

  /** Push a Thalos milestone state change to Trustless Work. */
  async pushMilestoneToTW(ctx: SyncMilestoneContext): Promise<SyncResult> {
    const base: Pick<SyncResult, 'direction' | 'agreementId' | 'milestoneIndex'> = {
      direction: 'thalos_to_tw',
      agreementId: ctx.agreementId,
      milestoneIndex: ctx.milestoneIndex,
    };

    // No TW action needed for pending — it's the initial/reset state
    if (ctx.thalosStatus === 'pending') {
      return { ...base, success: true, reason: 'no_sync_required' };
    }

    if (await this.isAlreadyProcessed(ctx.idempotencyKey)) {
      this.logger.log(
        `Idempotent skip: agreementId=${ctx.agreementId} milestone=${ctx.milestoneIndex} status=${ctx.thalosStatus}`,
      );
      return { ...base, success: true, reason: 'already_applied' };
    }

    const conflict = await this.conflictService.detectConflict(
      ctx.contractId,
      ctx.milestoneIndex,
      ctx.thalosStatus,
      ctx.serviceType,
    );
    if (conflict) {
      await this.conflictService.recordConflict(ctx.agreementId, ctx.milestoneIndex, conflict);
      this.eventEmitter.emit(MILESTONE_SYNC_EVENTS.SYNC_CONFLICT, {
        ...base,
        ...conflict,
      });
      await this.updateMilestoneSyncFields(ctx.agreementId, ctx.milestoneIndex, 'conflict');
      return { ...base, success: false, reason: 'conflict', conflictDetails: conflict };
    }

    this.eventEmitter.emit(MILESTONE_SYNC_EVENTS.SYNC_STARTED, {
      ...base,
      idempotencyKey: ctx.idempotencyKey,
    });

    try {
      let twResponse: unknown;

      if (ctx.thalosStatus === 'approved') {
        twResponse = await approveMilestone({
          contractId: ctx.contractId,
          milestoneIndex: String(ctx.milestoneIndex),
          approver: ctx.actorWallet,
          type: ctx.serviceType,
        });
      } else {
        // released → TW 'completed' (service provider marks work done)
        twResponse = await changeMilestoneStatus({
          contractId: ctx.contractId,
          milestoneIndex: String(ctx.milestoneIndex),
          newEvidence: ctx.evidence ?? '',
          newStatus: THALOS_TO_TW_STATUS[ctx.thalosStatus],
          serviceProvider: ctx.actorWallet,
          type: ctx.serviceType,
        });
      }

      const twStatus = THALOS_TO_TW_STATUS[ctx.thalosStatus];
      await this.markProcessed(ctx.idempotencyKey, { ...base, success: true });
      await this.updateMilestoneSyncFields(
        ctx.agreementId,
        ctx.milestoneIndex,
        'awaiting_signature',
        twStatus,
      );
      await this.logActivity(ctx.agreementId, ctx.actorWallet, 'milestone_sync_initiated', {
        milestone_index: ctx.milestoneIndex,
        thalos_status: ctx.thalosStatus,
        tw_status: twStatus,
      });

      this.eventEmitter.emit(MILESTONE_SYNC_EVENTS.SYNC_SUCCEEDED, {
        ...base,
        thalosStatus: ctx.thalosStatus,
        twStatus,
        unsignedTransaction: (twResponse as Record<string, unknown>)?.unsignedTransaction,
      });

      return { ...base, success: true };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(
        `pushMilestoneToTW failed: agreementId=${ctx.agreementId} milestone=${ctx.milestoneIndex}: ${message}`,
      );
      await this.retryService.scheduleRetry(ctx, message);
      this.eventEmitter.emit(MILESTONE_SYNC_EVENTS.SYNC_FAILED, {
        ...base,
        error: message,
      });
      return { ...base, success: false, reason: message };
    }
  }

  /** Apply a TW milestone state change back to the Thalos database. */
  async applyTWMilestoneToThalos(
    contractId: string,
    milestoneIndex: number,
    twStatus: string,
  ): Promise<SyncResult> {
    const base: Pick<SyncResult, 'direction' | 'milestoneIndex'> = {
      direction: 'tw_to_thalos',
      milestoneIndex,
    };

    const thalosStatus = TW_TO_THALOS_STATUS[twStatus];
    if (!thalosStatus) {
      this.logger.warn(`Unknown TW milestone status "${twStatus}" — skipping`);
      return { ...base, agreementId: '', success: false, reason: 'unknown_tw_status' };
    }

    // Resolve agreement from contractId
    const { data: agreement, error: fetchErr } = await this.supabase
      .getClient()
      .from('agreements')
      .select('id, milestones, title, asset')
      .eq('contract_id', contractId)
      .maybeSingle();

    if (fetchErr || !agreement) {
      this.logger.warn(`No agreement found for contractId="${contractId}"`);
      return { ...base, agreementId: '', success: false, reason: 'agreement_not_found' };
    }

    const row = agreement as {
      id: string;
      milestones: MilestoneRecord[];
      title: string;
      asset: string;
    };
    const baseWithId = { ...base, agreementId: row.id };

    if (milestoneIndex < 0 || milestoneIndex >= row.milestones.length) {
      return { ...baseWithId, success: false, reason: 'invalid_milestone_index' };
    }

    const milestone = row.milestones[milestoneIndex];

    // Idempotency: skip if milestone already has the target status
    if (milestone.status === thalosStatus) {
      this.logger.log(
        `Idempotent skip (TW→Thalos): agreement=${row.id} milestone=${milestoneIndex} already="${thalosStatus}"`,
      );
      return { ...baseWithId, success: true, reason: 'already_applied' };
    }

    // Update milestone in array
    row.milestones[milestoneIndex] = {
      ...milestone,
      status: thalosStatus,
      sync_state: 'synced',
      last_synced_at: new Date().toISOString(),
      tw_status: twStatus,
    };

    const { error: updateErr } = await this.supabase
      .getClient()
      .from('agreements')
      .update({ milestones: row.milestones, updated_at: new Date().toISOString() })
      .eq('id', row.id);

    if (updateErr) {
      this.logger.error(`applyTWMilestoneToThalos DB update failed: ${updateErr.message}`);
      return { ...baseWithId, success: false, reason: 'db_error' };
    }

    await this.logSyncResult(
      row.id,
      milestoneIndex,
      'tw_to_thalos',
      thalosStatus,
      twStatus,
      'succeeded',
    );
    await this.logActivity(row.id, 'trustless-work-webhook', 'milestone_sync_applied', {
      milestone_index: milestoneIndex,
      tw_status: twStatus,
      thalos_status: thalosStatus,
    });

    // Re-emit domain events so notification listeners still fire
    if (thalosStatus === 'approved') {
      this.eventEmitter.emit(AgreementEventName.MilestoneApproved, {
        agreementId: row.id,
        agreementTitle: row.title,
        milestoneIndex,
        milestoneDescription: milestone.description,
        milestoneAmount: milestone.amount,
        asset: row.asset ?? 'USDC',
        approvedByWallet: 'trustless-work-webhook',
      });
    }

    this.eventEmitter.emit(MILESTONE_SYNC_EVENTS.SYNC_SUCCEEDED, {
      direction: 'tw_to_thalos',
      agreementId: row.id,
      milestoneIndex,
      thalosStatus,
      twStatus,
    });

    return { ...baseWithId, success: true };
  }

  /** Compares every milestone between Thalos DB and TW live state. */
  async reconcileAgreementMilestones(
    agreementId: string,
    contractId: string,
    serviceType: 'single-release' | 'multi-release',
  ): Promise<SyncResult[]> {
    const { data: agreement, error } = await this.supabase
      .getClient()
      .from('agreements')
      .select('milestones')
      .eq('id', agreementId)
      .single();

    if (error || !agreement) return [];

    const milestones = (agreement as { milestones: MilestoneRecord[] }).milestones;
    const results: SyncResult[] = [];

    for (let i = 0; i < milestones.length; i++) {
      const conflict = await this.conflictService.detectConflict(
        contractId,
        i,
        milestones[i].status,
        serviceType,
      );

      if (conflict) {
        await this.conflictService.recordConflict(agreementId, i, conflict);
        this.eventEmitter.emit(MILESTONE_SYNC_EVENTS.SYNC_CONFLICT, {
          direction: 'thalos_to_tw',
          agreementId,
          milestoneIndex: i,
          ...conflict,
        });
        results.push({
          success: false,
          direction: 'thalos_to_tw',
          agreementId,
          milestoneIndex: i,
          reason: 'conflict',
          conflictDetails: conflict,
        });
      } else {
        results.push({
          success: true,
          direction: 'thalos_to_tw',
          agreementId,
          milestoneIndex: i,
          reason: 'in_sync',
        });
      }
    }

    return results;
  }

  private async isAlreadyProcessed(idempotencyKey: string): Promise<boolean> {
    const { data } = await this.supabase
      .getClient()
      .from('milestone_sync_log')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    return !!data;
  }

  private async markProcessed(idempotencyKey: string, result: SyncResult): Promise<void> {
    try {
      await this.supabase.getClient().from('milestone_sync_log').insert({
        idempotency_key: idempotencyKey,
        agreement_id: result.agreementId,
        milestone_index: result.milestoneIndex,
        direction: result.direction,
        thalos_status: '',
        outcome: result.success ? 'succeeded' : 'failed',
        error_message: result.reason ?? null,
      });
    } catch (err) {
      this.logger.error(`markProcessed insert failed: ${(err as Error).message}`);
    }
  }

  private async logSyncResult(
    agreementId: string,
    milestoneIndex: number,
    direction: 'thalos_to_tw' | 'tw_to_thalos',
    thalosStatus: string,
    twStatus: string,
    outcome: 'succeeded' | 'failed' | 'already_applied' | 'conflict',
  ): Promise<void> {
    try {
      const idempotencyKey = MilestoneSyncService.buildIdempotencyKey(
        agreementId,
        milestoneIndex,
        thalosStatus,
      );
      await this.supabase.getClient().from('milestone_sync_log').insert({
        idempotency_key: idempotencyKey,
        agreement_id: agreementId,
        milestone_index: milestoneIndex,
        direction,
        thalos_status: thalosStatus,
        tw_status: twStatus,
        outcome,
      });
    } catch {
      // Non-blocking
    }
  }

  private async updateMilestoneSyncFields(
    agreementId: string,
    milestoneIndex: number,
    syncState: 'idle' | 'awaiting_signature' | 'synced' | 'conflict',
    twStatus?: string,
  ): Promise<void> {
    try {
      const { data: row } = await this.supabase
        .getClient()
        .from('agreements')
        .select('milestones')
        .eq('id', agreementId)
        .maybeSingle();

      if (!row) return;

      const milestones = (row as { milestones: MilestoneRecord[] }).milestones;
      if (milestoneIndex >= milestones.length) return;

      milestones[milestoneIndex] = {
        ...milestones[milestoneIndex],
        sync_state: syncState,
        last_synced_at: new Date().toISOString(),
        ...(twStatus !== undefined ? { tw_status: twStatus } : {}),
      };

      await this.supabase
        .getClient()
        .from('agreements')
        .update({ milestones, updated_at: new Date().toISOString() })
        .eq('id', agreementId);
    } catch (err) {
      this.logger.error(`updateMilestoneSyncFields failed: ${(err as Error).message}`);
    }
  }

  private async logActivity(
    agreementId: string,
    actorWallet: string,
    action: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.supabase.getClient().from('agreement_activity').insert({
        agreement_id: agreementId,
        actor_wallet: actorWallet,
        action,
        details,
      });
    } catch (err) {
      this.logger.error('logActivity failed', err);
    }
  }
}
