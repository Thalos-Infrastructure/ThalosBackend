import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { InternalSecretGuard } from "../internal-trustless/internal-secret.guard";
import {
  NotifyAgreementCreatedDto,
  NotifyAgreementFundedDto,
  NotifyEvidenceSubmittedDto,
  NotifyMilestoneApprovedDto,
  NotifyDisputeOpenedDto,
  NotifyDisputeResolvedDto,
  NotifyAgreementCompletedDto,
  SendCustomNotificationDto,
} from "./dto/notification.dto";

/**
 * Internal controller for sending notifications.
 * Protected by internal secret guard - only accessible from trusted services.
 */
@Controller("internal/notifications")
@UseGuards(InternalSecretGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post("agreement-created")
  @HttpCode(HttpStatus.OK)
  async notifyAgreementCreated(@Body() dto: NotifyAgreementCreatedDto) {
    await this.notifications.notifyAgreementCreated({
      agreementId: dto.agreement_id,
      title: dto.title,
      description: dto.description,
      amount: dto.amount,
      asset: dto.asset,
      createdByWallet: dto.created_by_wallet,
      createdByName: dto.created_by_name,
      participantWallets: dto.participant_wallets,
    });
    return { success: true };
  }

  @Post("agreement-funded")
  @HttpCode(HttpStatus.OK)
  async notifyAgreementFunded(@Body() dto: NotifyAgreementFundedDto) {
    await this.notifications.notifyAgreementFunded({
      agreementId: dto.agreement_id,
      title: dto.title,
      amount: dto.amount,
      asset: dto.asset,
      fundedByWallet: dto.funded_by_wallet,
      fundedByName: dto.funded_by_name,
      transactionSignature: dto.transaction_signature,
    });
    return { success: true };
  }

  @Post("evidence-submitted")
  @HttpCode(HttpStatus.OK)
  async notifyEvidenceSubmitted(@Body() dto: NotifyEvidenceSubmittedDto) {
    await this.notifications.notifyEvidenceSubmitted({
      agreementId: dto.agreement_id,
      agreementTitle: dto.agreement_title,
      milestoneIndex: dto.milestone_index,
      milestoneDescription: dto.milestone_description,
      submittedByWallet: dto.submitted_by_wallet,
      submittedByName: dto.submitted_by_name,
      evidenceDescription: dto.evidence_description,
    });
    return { success: true };
  }

  @Post("milestone-approved")
  @HttpCode(HttpStatus.OK)
  async notifyMilestoneApproved(@Body() dto: NotifyMilestoneApprovedDto) {
    await this.notifications.notifyMilestoneApproved({
      agreementId: dto.agreement_id,
      agreementTitle: dto.agreement_title,
      milestoneIndex: dto.milestone_index,
      milestoneDescription: dto.milestone_description,
      milestoneAmount: dto.milestone_amount,
      asset: dto.asset,
      approvedByWallet: dto.approved_by_wallet,
      approvedByName: dto.approved_by_name,
    });
    return { success: true };
  }

  @Post("dispute-opened")
  @HttpCode(HttpStatus.OK)
  async notifyDisputeOpened(@Body() dto: NotifyDisputeOpenedDto) {
    await this.notifications.notifyDisputeOpened({
      agreementId: dto.agreement_id,
      agreementTitle: dto.agreement_title,
      disputeReason: dto.dispute_reason,
      openedByWallet: dto.opened_by_wallet,
      openedByName: dto.opened_by_name,
      milestoneIndex: dto.milestone_index,
      milestoneDescription: dto.milestone_description,
    });
    return { success: true };
  }

  @Post("dispute-resolved")
  @HttpCode(HttpStatus.OK)
  async notifyDisputeResolved(@Body() dto: NotifyDisputeResolvedDto) {
    await this.notifications.notifyDisputeResolved({
      agreementId: dto.agreement_id,
      agreementTitle: dto.agreement_title,
      resolution: dto.resolution,
      resolvedByWallet: dto.resolved_by_wallet,
      resolvedByName: dto.resolved_by_name,
      winnerWallet: dto.winner_wallet,
      refundAmount: dto.refund_amount,
      releaseAmount: dto.release_amount,
      asset: dto.asset,
    });
    return { success: true };
  }

  @Post("agreement-completed")
  @HttpCode(HttpStatus.OK)
  async notifyAgreementCompleted(@Body() dto: NotifyAgreementCompletedDto) {
    await this.notifications.notifyAgreementCompleted({
      agreementId: dto.agreement_id,
      title: dto.title,
      totalAmount: dto.total_amount,
      asset: dto.asset,
      completedAt: dto.completed_at,
    });
    return { success: true };
  }

  @Post("custom")
  @HttpCode(HttpStatus.OK)
  async sendCustomNotification(@Body() dto: SendCustomNotificationDto) {
    await this.notifications.sendCustomNotification(
      dto.wallets,
      dto.subject,
      dto.html,
    );
    return { success: true };
  }
}
