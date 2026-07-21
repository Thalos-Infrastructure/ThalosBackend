import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import type { TrustlessWorkEventDto } from './dto/trustless-work-event.dto';

interface EventConfig {
  action: 'status_update' | 'milestone_update' | 'info';
  targetStatus?: string;
}

const TW_EVENT_MAP: Record<string, EventConfig> = {
  'escrow.funded': { action: 'status_update', targetStatus: 'funded' },
  'escrow.released': { action: 'status_update', targetStatus: 'completed' },
  'escrow.disputed': { action: 'status_update', targetStatus: 'disputed' },
  'contract.completed': { action: 'status_update', targetStatus: 'completed' },
  'contract.cancelled': { action: 'status_update', targetStatus: 'cancelled' },
  'agreement.created': { action: 'info' },
  'agreement.updated': { action: 'info' },
  'agreement.milestone_updated': { action: 'milestone_update' },
  'escrow.created': { action: 'info' },
  'escrow.updated': { action: 'info' },
  'escrow.milestone_updated': { action: 'milestone_update' },
  'escrow.dispute_created': { action: 'status_update', targetStatus: 'disputed' },
  'dispute.created': { action: 'status_update', targetStatus: 'disputed' },
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly webhookSecret: string;
  private readonly maxRetries = 3;
  private readonly baseRetryDelay = 1_000;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {
    this.webhookSecret = this.config.get<string>('TRUSTLESS_WORK_WEBHOOK_SECRET', '');
  }

  verifySignature(rawBody: Buffer, signatureHeader: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('TRUSTLESS_WORK_WEBHOOK_SECRET not configured — rejecting all requests');
      return false;
    }
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const provided = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice(7)
      : signatureHeader;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
    } catch {
      return false;
    }
  }

  async handleEvent(
    payload: TrustlessWorkEventDto,
  ): Promise<{ handled: boolean; reason?: string }> {
    this.logger.log(`Incoming TW event: "${payload.event}" for contractId="${payload.contractId}"`);

    const config = TW_EVENT_MAP[payload.event];

    if (!config) {
      this.logger.log(`Unhandled TW event type: "${payload.event}" — skipping`);
      return { handled: false, reason: 'unhandled_event_type' };
    }

    try {
      await this.withRetry(() => this.processEvent(payload, config), payload.event);
      return { handled: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to process event "${payload.event}" for contractId="${payload.contractId}" ` +
          `after ${this.maxRetries} retries — ${message}`,
      );
      return { handled: false, reason: 'processing_failed' };
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : error && typeof error === 'object' && 'message' in error
              ? String(error.message)
              : String(error);
        lastError = error instanceof Error ? error : new Error(message);
        if (attempt < this.maxRetries) {
          const delay = this.baseRetryDelay * 2 ** attempt;
          this.logger.warn(
            `Retrying "${label}" (attempt ${attempt + 1}/${this.maxRetries}) after ${delay}ms — ${lastError.message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError ?? new Error(`"${label}" failed after ${this.maxRetries} retries`);
  }

  private async processEvent(payload: TrustlessWorkEventDto, config: EventConfig): Promise<void> {
    switch (config.action) {
      case 'status_update':
        await this.applyStatusUpdate(payload, config.targetStatus!);
        break;
      case 'milestone_update':
        await this.applyMilestoneUpdate(payload);
        break;
      case 'info':
        await this.applyInfoUpdate(payload);
        break;
    }
  }

  private async applyStatusUpdate(
    payload: TrustlessWorkEventDto,
    targetStatus: string,
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      status: targetStatus,
      updated_at: new Date().toISOString(),
    };
    if (targetStatus === 'funded') updates.funded_at = new Date().toISOString();
    if (targetStatus === 'completed') updates.completed_at = new Date().toISOString();

    const { data: updated, error: updateError } = await this.supabase
      .getClient()
      .from('agreements')
      .update(updates)
      .eq('contract_id', payload.contractId)
      .neq('status', targetStatus)
      .select('id, title, amount, asset')
      .maybeSingle();

    if (updateError) {
      this.logger.error(
        `DB update failed for contractId="${payload.contractId}": ${updateError.message}`,
      );
      throw new Error(updateError.message);
    }

    if (!updated) {
      const { data: existing } = await this.supabase
        .getClient()
        .from('agreements')
        .select('id, status')
        .eq('contract_id', payload.contractId)
        .maybeSingle();

      if (!existing) {
        this.logger.warn(`No agreement found for contractId="${payload.contractId}"`);
        throw new Error(`Agreement not found for contractId="${payload.contractId}"`);
      }

      this.logger.log(
        `Idempotent duplicate: agreement ${(existing as { id: string }).id} already has status="${targetStatus}"`,
      );
      return;
    }

    const row = updated;

    await this.logActivity(
      row.id,
      'trustless-work-webhook',
      `webhook_status_changed_to_${targetStatus}`,
      {
        event: payload.event,
        contractId: payload.contractId,
      },
    );

    await this.dispatchNotification(targetStatus, row);
  }

  private async applyMilestoneUpdate(payload: TrustlessWorkEventDto): Promise<void> {
    const { data: agreement, error: fetchError } = await this.supabase
      .getClient()
      .from('agreements')
      .select('id, milestones')
      .eq('contract_id', payload.contractId)
      .maybeSingle();

    if (fetchError || !agreement) {
      this.logger.warn(
        `No agreement found for milestone update: contractId="${payload.contractId}"`,
      );
      return;
    }

    const milestoneIndex =
      payload.milestone?.index ?? (payload.data?.milestone_index as number | undefined);
    if (milestoneIndex === undefined || milestoneIndex < 0) {
      this.logger.warn(
        `Milestone update missing milestone index for contractId="${payload.contractId}"`,
      );
      return;
    }

    const milestones = (agreement as { milestones: Array<Record<string, unknown>> }).milestones;
    if (!milestones || milestoneIndex >= milestones.length) {
      this.logger.warn(
        `Invalid milestone index ${milestoneIndex} for contractId="${payload.contractId}"`,
      );
      return;
    }

    if (payload.milestone?.status) {
      milestones[milestoneIndex].status = payload.milestone.status;
    }
    if (payload.milestone?.description) {
      milestones[milestoneIndex].description = payload.milestone.description;
    }

    const { error: updateError } = await this.supabase
      .getClient()
      .from('agreements')
      .update({ milestones, updated_at: new Date().toISOString() })
      .eq('contract_id', payload.contractId);

    if (updateError) {
      this.logger.error(
        `Milestone update failed for contractId="${payload.contractId}": ${updateError.message}`,
      );
      throw updateError;
    }

    await this.logActivity(agreement.id, 'trustless-work-webhook', 'webhook_milestone_updated', {
      event: payload.event,
      contractId: payload.contractId,
      milestone_index: milestoneIndex,
    });
  }

  private async applyInfoUpdate(payload: TrustlessWorkEventDto): Promise<void> {
    const { data: agreement, error: fetchError } = await this.supabase
      .getClient()
      .from('agreements')
      .select('id')
      .eq('contract_id', payload.contractId)
      .maybeSingle();

    if (fetchError || !agreement) {
      this.logger.log(`Info event for unknown contractId="${payload.contractId}" — logging anyway`);
      return;
    }

    await this.logActivity(
      agreement.id,
      'trustless-work-webhook',
      `webhook_event_${payload.event.replace('.', '_')}`,
      {
        event: payload.event,
        contractId: payload.contractId,
        data: payload.data,
      },
    );
  }

  private async dispatchNotification(
    status: string,
    agreement: { id: string; title: string; amount: string; asset: string },
  ): Promise<void> {
    try {
      if (status === 'funded') {
        this.eventEmitter.emit(AGREEMENT_EVENTS.FUNDED, {
          agreementId: agreement.id,
          title: agreement.title,
          amount: agreement.amount,
          asset: agreement.asset ?? 'USDC',
          fundedByWallet: 'trustless-work',
        });
      } else if (status === 'completed') {
        this.eventEmitter.emit(AGREEMENT_EVENTS.COMPLETED, {
          agreementId: agreement.id,
          title: agreement.title,
          totalAmount: agreement.amount,
          asset: agreement.asset ?? 'USDC',
          completedAt: new Date().toISOString(),
        });
      } else if (status === 'disputed') {
        await this.notifications.notifyDisputeOpened({
          agreementId: agreement.id,
          agreementTitle: agreement.title,
          disputeReason: 'Dispute raised via Trustless Work',
          openedByWallet: 'trustless-work',
        });
      }
    } catch (err) {
      this.logger.error('Notification dispatch error', err);
    }
  }

  private async logActivity(
    agreementId: string,
    actorWallet: string,
    action: string,
    details: Record<string, unknown> = {},
  ) {
    try {
      await this.supabase.getClient().from('agreement_activity').insert({
        agreement_id: agreementId,
        actor_wallet: actorWallet,
        action,
        details,
      });
    } catch (e) {
      this.logger.error('logActivity', e);
    }
  }
}
