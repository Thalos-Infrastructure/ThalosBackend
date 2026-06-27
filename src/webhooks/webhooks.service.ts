import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import type { TrustlessWorkEventDto } from './dto/trustless-work-event.dto';

const TW_EVENT_MAP: Record<string, string> = {
  'escrow.funded': 'funded',
  'escrow.released': 'completed',
  'escrow.disputed': 'disputed',
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly webhookSecret: string;

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
    const targetStatus = TW_EVENT_MAP[payload.event];

    if (!targetStatus) {
      this.logger.log(`Unhandled TW event type: "${payload.event}" — skipping`);
      return { handled: false, reason: 'unhandled_event_type' };
    }

    const updates: Record<string, unknown> = {
      status: targetStatus,
      updated_at: new Date().toISOString(),
    };
    if (targetStatus === 'funded') updates.funded_at = new Date().toISOString();
    if (targetStatus === 'completed') updates.completed_at = new Date().toISOString();

    // Atomic conditional update: only applies when status != targetStatus.
    // Prevents double-processing if two identical webhooks arrive in parallel.
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
      return { handled: false, reason: 'db_error' };
    }

    if (!updated) {
      // No row was modified — either agreement doesn't exist or status already matches.
      const { data: existing } = await this.supabase
        .getClient()
        .from('agreements')
        .select('id, status')
        .eq('contract_id', payload.contractId)
        .maybeSingle();

      if (!existing) {
        this.logger.warn(`No agreement found for contractId="${payload.contractId}"`);
        return { handled: false, reason: 'agreement_not_found' };
      }

      this.logger.log(
        `Idempotent duplicate: agreement ${(existing as { id: string }).id} already has status="${targetStatus}"`,
      );
      return { handled: true, reason: 'already_applied' };
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

    return { handled: true };
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
