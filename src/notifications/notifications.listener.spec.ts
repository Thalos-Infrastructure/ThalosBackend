import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import {
  AgreementCreatedData,
  AgreementFundedData,
  AgreementCompletedData,
  EvidenceSubmittedData,
  MilestoneApprovedData,
} from './types/notification-data.types';
import type {
  DisputeOpenedEventPayload,
  DisputeResolvedEventPayload,
} from '../common/constants/notification-events';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let notificationsService: {
    notifyAgreementCreated: jest.Mock;
    notifyAgreementFunded: jest.Mock;
    notifyAgreementCompleted: jest.Mock;
    notifyEvidenceSubmitted: jest.Mock;
    notifyMilestoneApproved: jest.Mock;
    handleDisputeOpened: jest.Mock;
    handleDisputeResolved: jest.Mock;
  };

  beforeEach(async () => {
    notificationsService = {
      notifyAgreementCreated: jest.fn(),
      notifyAgreementFunded: jest.fn(),
      notifyAgreementCompleted: jest.fn(),
      notifyEvidenceSubmitted: jest.fn(),
      notifyMilestoneApproved: jest.fn(),
      handleDisputeOpened: jest.fn(),
      handleDisputeResolved: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsListener,
        {
          provide: NotificationsService,
          useValue: notificationsService,
        },
      ],
    }).compile();

    listener = module.get<NotificationsListener>(NotificationsListener);
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  it('should call notifyAgreementCreated on AGREEMENT_CREATED event', async () => {
    const data: AgreementCreatedData = {
      agreementId: 'test-1',
      title: 'Test Agreement',
      description: 'Test Description',
      amount: '100',
      asset: 'USDC',
      createdByWallet: 'wallet1',
      participantWallets: ['wallet1', 'wallet2'],
    };
    await listener.handleAgreementCreated(data);
    expect(notificationsService.notifyAgreementCreated).toHaveBeenCalledWith(data);
  });

  it('should call notifyAgreementFunded on AGREEMENT_FUNDED event', async () => {
    const data: AgreementFundedData = {
      agreementId: 'test-1',
      title: 'Test Agreement',
      amount: '100',
      asset: 'USDC',
      fundedByWallet: 'wallet1',
    };
    await listener.handleAgreementFunded(data);
    expect(notificationsService.notifyAgreementFunded).toHaveBeenCalledWith(data);
  });

  it('should call notifyAgreementCompleted on AGREEMENT_COMPLETED event', async () => {
    const data: AgreementCompletedData = {
      agreementId: 'test-1',
      title: 'Test Agreement',
      totalAmount: '100',
      asset: 'USDC',
      completedAt: new Date().toISOString(),
    };
    await listener.handleAgreementCompleted(data);
    expect(notificationsService.notifyAgreementCompleted).toHaveBeenCalledWith(data);
  });

  it('should call notifyEvidenceSubmitted on EVIDENCE_SUBMITTED event', async () => {
    const data: EvidenceSubmittedData = {
      agreementId: 'test-1',
      agreementTitle: 'Test Agreement',
      milestoneIndex: 0,
      milestoneDescription: 'Design',
      milestoneAmount: '50',
      asset: 'USDC',
      submittedByWallet: 'wallet1',
      evidenceDescription: 'Figma link',
      evidenceUrls: ['https://example.com/evidence'],
    };
    await listener.handleEvidenceSubmitted(data);
    expect(notificationsService.notifyEvidenceSubmitted).toHaveBeenCalledWith(data, 'wallet1');
  });

  it('should call notifyMilestoneApproved on MILESTONE_APPROVED event', async () => {
    const data: MilestoneApprovedData = {
      agreementId: 'test-1',
      agreementTitle: 'Test Agreement',
      milestoneIndex: 0,
      milestoneDescription: 'Design',
      milestoneAmount: '50',
      asset: 'USDC',
      approvedByWallet: 'wallet1',
    };
    await listener.handleMilestoneApproved(data);
    expect(notificationsService.notifyMilestoneApproved).toHaveBeenCalledWith(data);
  });

  it('should call handleDisputeOpened on DISPUTE_OPENED event', async () => {
    const payload: DisputeOpenedEventPayload = {
      disputeId: 'disp-1',
      agreementId: 'test-1',
      openedByWallet: 'wallet1',
      reason: 'Scope mismatch',
    };
    await listener.handleDisputeOpened(payload);
    expect(notificationsService.handleDisputeOpened).toHaveBeenCalledWith(payload);
  });

  it('should call handleDisputeResolved on DISPUTE_RESOLVED event', async () => {
    const payload: DisputeResolvedEventPayload = {
      disputeId: 'disp-1',
      agreementId: 'test-1',
      resolvedByWallet: 'wallet-resolver',
      payerPercentage: 40,
      payeePercentage: 60,
      resolutionNotes: 'Partial refund',
    };
    await listener.handleDisputeResolved(payload);
    expect(notificationsService.handleDisputeResolved).toHaveBeenCalledWith(payload);
  });

  it('should not throw error even if notifyAgreementCreated fails', async () => {
    notificationsService.notifyAgreementCreated.mockRejectedValueOnce(new Error('Test error'));
    const data: AgreementCreatedData = {
      agreementId: 'test-1',
      title: 'Test Agreement',
      amount: '100',
      asset: 'USDC',
      createdByWallet: 'wallet1',
      participantWallets: ['wallet1', 'wallet2'],
    };
    await expect(listener.handleAgreementCreated(data)).resolves.not.toThrow();
  });

  it('should not throw when evidence handler fails', async () => {
    notificationsService.notifyEvidenceSubmitted.mockRejectedValueOnce(new Error('email down'));
    const data: EvidenceSubmittedData = {
      agreementId: 'test-1',
      agreementTitle: 'Test Agreement',
      milestoneIndex: 0,
      milestoneDescription: 'Design',
      milestoneAmount: '50',
      asset: 'USDC',
      submittedByWallet: 'wallet1',
    };
    await expect(listener.handleEvidenceSubmitted(data)).resolves.not.toThrow();
  });

  it('should not throw when milestone approved handler fails', async () => {
    notificationsService.notifyMilestoneApproved.mockRejectedValueOnce(new Error('email down'));
    const data: MilestoneApprovedData = {
      agreementId: 'test-1',
      agreementTitle: 'Test Agreement',
      milestoneIndex: 0,
      milestoneDescription: 'Design',
      milestoneAmount: '50',
      asset: 'USDC',
      approvedByWallet: 'wallet1',
    };
    await expect(listener.handleMilestoneApproved(data)).resolves.not.toThrow();
  });

  it('should not throw when dispute opened handler fails', async () => {
    notificationsService.handleDisputeOpened.mockRejectedValueOnce(new Error('email down'));
    await expect(
      listener.handleDisputeOpened({
        disputeId: 'disp-1',
        agreementId: 'test-1',
        openedByWallet: 'wallet1',
        reason: 'Scope mismatch',
      }),
    ).resolves.not.toThrow();
  });

  it('should not throw when dispute resolved handler fails', async () => {
    notificationsService.handleDisputeResolved.mockRejectedValueOnce(new Error('email down'));
    await expect(
      listener.handleDisputeResolved({
        disputeId: 'disp-1',
        agreementId: 'test-1',
        resolvedByWallet: 'wallet-resolver',
        payerPercentage: 50,
        payeePercentage: 50,
        resolutionNotes: '',
      }),
    ).resolves.not.toThrow();
  });
});
