import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import type {
  DisputeOpenedEventPayload,
  DisputeResolvedEventPayload,
} from '../common/constants/notification-events';
import {
  AgreementCreatedData,
  AgreementFundedData,
  AgreementCompletedData,
  EvidenceSubmittedData,
  MilestoneApprovedData,
} from './types/notification-data.types';

/**
 * Sole @OnEvent subscriber for agreement lifecycle email notifications.
 * Keeps request paths resilient: handler failures are logged and never rethrown.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(AGREEMENT_EVENTS.CREATED)
  async handleAgreementCreated(data: AgreementCreatedData): Promise<void> {
    try {
      await this.notifications.notifyAgreementCreated(data);
    } catch (err) {
      this.logger.error('handleAgreementCreated failed', err);
    }
  }

  @OnEvent(AGREEMENT_EVENTS.FUNDED)
  async handleAgreementFunded(data: AgreementFundedData): Promise<void> {
    try {
      await this.notifications.notifyAgreementFunded(data);
    } catch (err) {
      this.logger.error('handleAgreementFunded failed', err);
    }
  }

  @OnEvent(AGREEMENT_EVENTS.COMPLETED)
  async handleAgreementCompleted(data: AgreementCompletedData): Promise<void> {
    try {
      await this.notifications.notifyAgreementCompleted(data);
    } catch (err) {
      this.logger.error('handleAgreementCompleted failed', err);
    }
  }

  @OnEvent(AGREEMENT_EVENTS.EVIDENCE_SUBMITTED)
  async handleEvidenceSubmitted(data: EvidenceSubmittedData): Promise<void> {
    try {
      await this.notifications.notifyEvidenceSubmitted(data, data.submittedByWallet);
    } catch (err) {
      this.logger.error('handleEvidenceSubmitted failed', err);
    }
  }

  @OnEvent(AGREEMENT_EVENTS.MILESTONE_APPROVED)
  async handleMilestoneApproved(data: MilestoneApprovedData): Promise<void> {
    try {
      await this.notifications.notifyMilestoneApproved(data);
    } catch (err) {
      this.logger.error('handleMilestoneApproved failed', err);
    }
  }

  @OnEvent(AGREEMENT_EVENTS.DISPUTE_OPENED)
  async handleDisputeOpened(payload: DisputeOpenedEventPayload): Promise<void> {
    try {
      await this.notifications.handleDisputeOpened(payload);
    } catch (err) {
      this.logger.error('handleDisputeOpened failed', err);
    }
  }

  @OnEvent(AGREEMENT_EVENTS.DISPUTE_RESOLVED)
  async handleDisputeResolved(payload: DisputeResolvedEventPayload): Promise<void> {
    try {
      await this.notifications.handleDisputeResolved(payload);
    } catch (err) {
      this.logger.error('handleDisputeResolved failed', err);
    }
  }
}
