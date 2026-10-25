import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import { AgreementChatService } from './agreement-chat.service';

/**
 * Writes a chat event for every agreement lifecycle emit.
 *
 * Failures are logged and never rethrown: a chat line must not roll back
 * funding, a dispute, or a notification.
 */
@Injectable()
export class AgreementChatEvents {
  private readonly logger = new Logger(AgreementChatEvents.name);

  constructor(private readonly chat: AgreementChatService) {}

  @OnEvent(AGREEMENT_EVENTS.CREATED)
  async onCreated(data: { agreementId?: string }): Promise<void> {
    await this.record(AGREEMENT_EVENTS.CREATED, data);
  }

  @OnEvent(AGREEMENT_EVENTS.FUNDED)
  async onFunded(data: { agreementId?: string }): Promise<void> {
    await this.record(AGREEMENT_EVENTS.FUNDED, data);
  }

  @OnEvent(AGREEMENT_EVENTS.COMPLETED)
  async onCompleted(data: { agreementId?: string }): Promise<void> {
    await this.record(AGREEMENT_EVENTS.COMPLETED, data);
  }

  @OnEvent(AGREEMENT_EVENTS.EVIDENCE_SUBMITTED)
  async onEvidence(data: { agreementId?: string; milestoneIndex?: number }): Promise<void> {
    await this.record(AGREEMENT_EVENTS.EVIDENCE_SUBMITTED, data);
  }

  @OnEvent(AGREEMENT_EVENTS.MILESTONE_APPROVED)
  async onApproved(data: { agreementId?: string; milestoneIndex?: number }): Promise<void> {
    await this.record(AGREEMENT_EVENTS.MILESTONE_APPROVED, data);
  }

  @OnEvent(AGREEMENT_EVENTS.MILESTONE_RELEASED)
  async onReleased(data: { agreementId?: string; milestoneIndex?: number }): Promise<void> {
    await this.record(AGREEMENT_EVENTS.MILESTONE_RELEASED, data);
  }

  @OnEvent(AGREEMENT_EVENTS.DISPUTE_OPENED)
  async onDisputeOpened(data: { agreementId?: string; reason?: string }): Promise<void> {
    await this.record(AGREEMENT_EVENTS.DISPUTE_OPENED, data);
  }

  @OnEvent(AGREEMENT_EVENTS.DISPUTE_RESOLVED)
  async onDisputeResolved(data: {
    agreementId?: string;
    payerPercentage?: number;
    payeePercentage?: number;
  }): Promise<void> {
    await this.record(AGREEMENT_EVENTS.DISPUTE_RESOLVED, data);
  }

  private async record(eventType: string, data: Record<string, unknown>): Promise<void> {
    const agreementId = typeof data.agreementId === 'string' ? data.agreementId : null;
    if (!agreementId) {
      this.logger.warn(`Skipped chat event ${eventType}: missing agreementId`);
      return;
    }

    try {
      await this.chat.appendEvent(agreementId, eventType, data);
    } catch (err) {
      this.logger.error(`Could not write chat event ${eventType} for ${agreementId}`, err);
    }
  }
}
