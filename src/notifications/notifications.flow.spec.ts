/**
 * Lightweight integration: EventEmitter2 → NotificationsListener → NotificationsService.
 * Proves dispute / evidence / milestone / funded paths reach the correct notify methods.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import { NotificationsListener } from './notifications.listener';
import type { NotificationsService } from './notifications.service';
import type {
  EvidenceSubmittedData,
  MilestoneApprovedData,
  AgreementFundedData,
  AgreementCompletedData,
} from './types/notification-data.types';
import type {
  DisputeOpenedEventPayload,
  DisputeResolvedEventPayload,
} from '../common/constants/notification-events';

/** Register an async listener; EventEmitter2.emitAsync awaits the returned promise. */
function onAsync<T>(
  emitter: EventEmitter2,
  event: string,
  handler: (data: T) => Promise<void>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- emitAsync awaits promise returns
  emitter.on(event, (data: T) => handler(data));
}

describe('Notifications flow (EventEmitter2 → Listener → Service)', () => {
  let emitter: EventEmitter2;
  let listener: NotificationsListener;
  let service: {
    notifyAgreementFunded: jest.Mock;
    notifyAgreementCompleted: jest.Mock;
    notifyEvidenceSubmitted: jest.Mock;
    notifyMilestoneApproved: jest.Mock;
    handleDisputeOpened: jest.Mock;
    handleDisputeResolved: jest.Mock;
  };

  beforeEach(() => {
    emitter = new EventEmitter2();
    service = {
      notifyAgreementFunded: jest.fn().mockResolvedValue(undefined),
      notifyAgreementCompleted: jest.fn().mockResolvedValue(undefined),
      notifyEvidenceSubmitted: jest.fn().mockResolvedValue(undefined),
      notifyMilestoneApproved: jest.fn().mockResolvedValue(undefined),
      handleDisputeOpened: jest.fn().mockResolvedValue(undefined),
      handleDisputeResolved: jest.fn().mockResolvedValue(undefined),
    };

    listener = new NotificationsListener(service as unknown as NotificationsService);

    onAsync(emitter, AGREEMENT_EVENTS.FUNDED, (data: AgreementFundedData) =>
      listener.handleAgreementFunded(data),
    );
    onAsync(emitter, AGREEMENT_EVENTS.COMPLETED, (data: AgreementCompletedData) =>
      listener.handleAgreementCompleted(data),
    );
    onAsync(emitter, AGREEMENT_EVENTS.EVIDENCE_SUBMITTED, (data: EvidenceSubmittedData) =>
      listener.handleEvidenceSubmitted(data),
    );
    onAsync(emitter, AGREEMENT_EVENTS.MILESTONE_APPROVED, (data: MilestoneApprovedData) =>
      listener.handleMilestoneApproved(data),
    );
    onAsync(emitter, AGREEMENT_EVENTS.DISPUTE_OPENED, (data: DisputeOpenedEventPayload) =>
      listener.handleDisputeOpened(data),
    );
    onAsync(emitter, AGREEMENT_EVENTS.DISPUTE_RESOLVED, (data: DisputeResolvedEventPayload) =>
      listener.handleDisputeResolved(data),
    );
  });

  it('dispute opened event reaches handleDisputeOpened', async () => {
    const payload: DisputeOpenedEventPayload = {
      disputeId: 'd1',
      agreementId: 'a1',
      openedByWallet: 'GOPENER',
      reason: 'Late delivery',
    };
    await emitter.emitAsync(AGREEMENT_EVENTS.DISPUTE_OPENED, payload);
    expect(service.handleDisputeOpened).toHaveBeenCalledWith(payload);
  });

  it('dispute resolved event reaches handleDisputeResolved', async () => {
    const payload: DisputeResolvedEventPayload = {
      disputeId: 'd1',
      agreementId: 'a1',
      resolvedByWallet: 'GRESOLVER',
      payerPercentage: 30,
      payeePercentage: 70,
      resolutionNotes: 'Split',
    };
    await emitter.emitAsync(AGREEMENT_EVENTS.DISPUTE_RESOLVED, payload);
    expect(service.handleDisputeResolved).toHaveBeenCalledWith(payload);
  });

  it('evidence submitted event reaches notifyEvidenceSubmitted', async () => {
    const data: EvidenceSubmittedData = {
      agreementId: 'a1',
      agreementTitle: 'Title',
      milestoneIndex: 0,
      milestoneDescription: 'M1',
      milestoneAmount: '10',
      asset: 'USDC',
      submittedByWallet: 'GSUBMIT',
    };
    await emitter.emitAsync(AGREEMENT_EVENTS.EVIDENCE_SUBMITTED, data);
    expect(service.notifyEvidenceSubmitted).toHaveBeenCalledWith(data, 'GSUBMIT');
  });

  it('milestone approved event reaches notifyMilestoneApproved', async () => {
    const data: MilestoneApprovedData = {
      agreementId: 'a1',
      agreementTitle: 'Title',
      milestoneIndex: 0,
      milestoneDescription: 'M1',
      milestoneAmount: '10',
      asset: 'USDC',
      approvedByWallet: 'GAPPROVER',
    };
    await emitter.emitAsync(AGREEMENT_EVENTS.MILESTONE_APPROVED, data);
    expect(service.notifyMilestoneApproved).toHaveBeenCalledWith(data);
  });

  it('funded and completed (webhook regression path) still reach notify methods', async () => {
    const funded: AgreementFundedData = {
      agreementId: 'a1',
      title: 'Title',
      amount: '100',
      asset: 'USDC',
      fundedByWallet: 'trustless-work',
    };
    const completed: AgreementCompletedData = {
      agreementId: 'a1',
      title: 'Title',
      totalAmount: '100',
      asset: 'USDC',
      completedAt: new Date().toISOString(),
    };
    await emitter.emitAsync(AGREEMENT_EVENTS.FUNDED, funded);
    await emitter.emitAsync(AGREEMENT_EVENTS.COMPLETED, completed);
    expect(service.notifyAgreementFunded).toHaveBeenCalledWith(funded);
    expect(service.notifyAgreementCompleted).toHaveBeenCalledWith(completed);
  });

  it('listener failure is swallowed and does not reject emitAsync', async () => {
    service.handleDisputeOpened.mockRejectedValueOnce(new Error('resend down'));
    await expect(
      emitter.emitAsync(AGREEMENT_EVENTS.DISPUTE_OPENED, {
        disputeId: 'd1',
        agreementId: 'a1',
        openedByWallet: 'G',
        reason: 'x',
      }),
    ).resolves.toBeDefined();
  });
});
