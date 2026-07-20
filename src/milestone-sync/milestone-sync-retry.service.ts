import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseService } from '../supabase/supabase.service';
import { MILESTONE_SYNC_EVENTS, SYNC_RETRY_CONFIG } from './milestone-sync.constants';
import type { SyncMilestoneContext } from './dto/sync-milestone.dto';

@Injectable()
export class MilestoneSyncRetryService {
  private readonly logger = new Logger(MilestoneSyncRetryService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async scheduleRetry(ctx: SyncMilestoneContext, error: string): Promise<void> {
    try {
      const { data: existing } = await this.supabase
        .getClient()
        .from('milestone_sync_queue')
        .select('id, attempt_count')
        .eq('idempotency_key', ctx.idempotencyKey)
        .maybeSingle();

      if (existing) {
        const attemptCount: number = (existing as { attempt_count: number }).attempt_count + 1;

        if (attemptCount >= SYNC_RETRY_CONFIG.maxAttempts) {
          await this.moveToDeadLetter(
            (existing as { id: string }).id,
            ctx,
            error,
            attemptCount,
          );
          return;
        }

        const nextAttemptAt = new Date(
          Date.now() + this.computeDelayMs(attemptCount),
        ).toISOString();

        await this.supabase
          .getClient()
          .from('milestone_sync_queue')
          .update({
            attempt_count: attemptCount,
            last_error: error,
            next_attempt_at: nextAttemptAt,
            updated_at: new Date().toISOString(),
          })
          .eq('id', (existing as { id: string }).id);
      } else {
        const nextAttemptAt = new Date(
          Date.now() + this.computeDelayMs(1),
        ).toISOString();

        await this.supabase.getClient().from('milestone_sync_queue').insert({
          agreement_id: ctx.agreementId,
          contract_id: ctx.contractId,
          milestone_index: ctx.milestoneIndex,
          thalos_status: ctx.thalosStatus,
          actor_wallet: ctx.actorWallet,
          service_type: ctx.serviceType,
          evidence: ctx.evidence ?? null,
          idempotency_key: ctx.idempotencyKey,
          attempt_count: 1,
          last_error: error,
          next_attempt_at: nextAttemptAt,
          status: 'pending',
        });
      }
    } catch (err) {
      this.logger.error(`scheduleRetry failed: ${(err as Error).message}`);
    }
  }

  /** Processes queue rows whose next_attempt_at is in the past. Called by a future cron. */
  async processPendingRetries(
    pushFn: (ctx: SyncMilestoneContext) => Promise<{ success: boolean }>,
  ): Promise<void> {
    const { data: rows, error } = await this.supabase
      .getClient()
      .from('milestone_sync_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .limit(50);

    if (error || !rows?.length) return;

    for (const row of rows as Array<Record<string, unknown>>) {
      const ctx: SyncMilestoneContext = {
        agreementId: row['agreement_id'] as string,
        contractId: row['contract_id'] as string,
        milestoneIndex: row['milestone_index'] as number,
        thalosStatus: row['thalos_status'] as 'pending' | 'approved' | 'released',
        actorWallet: row['actor_wallet'] as string,
        serviceType: row['service_type'] as 'single-release' | 'multi-release',
        evidence: row['evidence'] as string | undefined,
        idempotencyKey: row['idempotency_key'] as string,
      };

      await this.supabase
        .getClient()
        .from('milestone_sync_queue')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', row['id']);

      try {
        const result = await pushFn(ctx);
        if (result.success) {
          await this.supabase
            .getClient()
            .from('milestone_sync_queue')
            .delete()
            .eq('id', row['id']);
        } else {
          await this.supabase
            .getClient()
            .from('milestone_sync_queue')
            .update({ status: 'pending', updated_at: new Date().toISOString() })
            .eq('id', row['id']);
        }
      } catch (err) {
        this.logger.error(`processPendingRetries: retry failed for id=${row['id']}`);
        await this.supabase
          .getClient()
          .from('milestone_sync_queue')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', row['id']);
      }
    }
  }

  private async moveToDeadLetter(
    queueId: string,
    ctx: SyncMilestoneContext,
    lastError: string,
    attemptCount: number,
  ): Promise<void> {
    await this.supabase
      .getClient()
      .from('milestone_sync_queue')
      .update({
        status: 'dead_letter',
        last_error: lastError,
        attempt_count: attemptCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', queueId);

    this.eventEmitter.emit(MILESTONE_SYNC_EVENTS.SYNC_DEAD_LETTER, {
      agreementId: ctx.agreementId,
      milestoneIndex: ctx.milestoneIndex,
      idempotencyKey: ctx.idempotencyKey,
      lastError,
      attemptCount,
    });

    this.logger.error(
      `Milestone sync dead-lettered: agreementId=${ctx.agreementId} milestoneIndex=${ctx.milestoneIndex} attempts=${attemptCount}`,
    );
  }

  private computeDelayMs(attemptNumber: number): number {
    return SYNC_RETRY_CONFIG.baseDelayMs * Math.pow(2, attemptNumber - 1);
  }
}
