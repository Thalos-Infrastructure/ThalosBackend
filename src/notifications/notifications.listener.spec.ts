import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsListener } from "./notifications.listener";
import { NotificationsService } from "./notifications.service";
import { DomainEvents } from "../common/events";
import {
  AgreementCreatedData,
  AgreementFundedData,
  AgreementCompletedData,
  MilestoneApprovedData,
  EvidenceSubmittedData,
  DisputeOpenedData,
  DisputeResolvedData,
} from "./types/notification-data.types";

describe("NotificationsListener", () => {
  let listener: NotificationsListener;
  let notificationsService: jest.Mocked<NotificationsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsListener,
        {
          provide: NotificationsService,
          useValue: {
            notifyAgreementCreated: jest.fn(),
            notifyAgreementFunded: jest.fn(),
            notifyAgreementCompleted: jest.fn(),
            notifyMilestoneApproved: jest.fn(),
            notifyEvidenceSubmitted: jest.fn(),
            notifyDisputeOpened: jest.fn(),
            notifyDisputeResolved: jest.fn(),
          },
        },
      ],
    }).compile();

    listener = module.get<NotificationsListener>(NotificationsListener);
    notificationsService = module.get(NotificationsService);
  });

  it("should be defined", () => {
    expect(listener).toBeDefined();
  });

  it("should call notifyAgreementCreated on AGREEMENT_CREATED event", async () => {
    const data: AgreementCreatedData = {
      agreementId: "test-1",
      title: "Test Agreement",
      description: "Test Description",
      amount: "100",
      asset: "USDC",
      createdByWallet: "wallet1",
      participantWallets: ["wallet1", "wallet2"],
    };
    await listener.handleAgreementCreated(data);
    expect(notificationsService.notifyAgreementCreated).toHaveBeenCalledWith(data);
  });

  it("should call notifyAgreementFunded on AGREEMENT_FUNDED event", async () => {
    const data: AgreementFundedData = {
      agreementId: "test-1",
      title: "Test Agreement",
      amount: "100",
      asset: "USDC",
      fundedByWallet: "wallet1",
    };
    await listener.handleAgreementFunded(data);
    expect(notificationsService.notifyAgreementFunded).toHaveBeenCalledWith(data);
  });

  it("should call notifyAgreementCompleted on AGREEMENT_COMPLETED event", async () => {
    const data: AgreementCompletedData = {
      agreementId: "test-1",
      title: "Test Agreement",
      totalAmount: "100",
      asset: "USDC",
      completedAt: new Date().toISOString(),
    };
    await listener.handleAgreementCompleted(data);
    expect(notificationsService.notifyAgreementCompleted).toHaveBeenCalledWith(data);
  });

  it("should call notifyMilestoneApproved on MILESTONE_APPROVED event", async () => {
    const data: MilestoneApprovedData = {
      agreementId: "test-1",
      agreementTitle: "Test Agreement",
      milestoneIndex: 0,
      milestoneDescription: "Test Milestone",
      milestoneAmount: "50",
      asset: "USDC",
      approvedByWallet: "wallet1",
    };
    await listener.handleMilestoneApproved(data);
    expect(notificationsService.notifyMilestoneApproved).toHaveBeenCalledWith(data);
  });

  it("should call notifyEvidenceSubmitted on EVIDENCE_SUBMITTED event", async () => {
    const data: EvidenceSubmittedData = {
      agreementId: "test-1",
      agreementTitle: "Test Agreement",
      milestoneIndex: 0,
      milestoneDescription: "Test Milestone",
      submittedByWallet: "wallet1",
    };
    await listener.handleEvidenceSubmitted(data);
    expect(notificationsService.notifyEvidenceSubmitted).toHaveBeenCalledWith(data);
  });

  it("should call notifyDisputeOpened on DISPUTE_OPENED event", async () => {
    const data: DisputeOpenedData = {
      agreementId: "test-1",
      agreementTitle: "Test Agreement",
      disputeReason: "Test Reason",
      openedByWallet: "wallet1",
    };
    await listener.handleDisputeOpened(data);
    expect(notificationsService.notifyDisputeOpened).toHaveBeenCalledWith(data);
  });

  it("should call notifyDisputeResolved on DISPUTE_RESOLVED event", async () => {
    const data: DisputeResolvedData = {
      agreementId: "test-1",
      agreementTitle: "Test Agreement",
      resolution: "Test Resolution",
      resolvedByWallet: "wallet1",
    };
    await listener.handleDisputeResolved(data);
    expect(notificationsService.notifyDisputeResolved).toHaveBeenCalledWith(data);
  });

  it("should not throw error even if notification fails", async () => {
    notificationsService.notifyAgreementCreated.mockRejectedValueOnce(new Error("Test error"));
    const data: AgreementCreatedData = {
      agreementId: "test-1",
      title: "Test Agreement",
      amount: "100",
      asset: "USDC",
      createdByWallet: "wallet1",
      participantWallets: ["wallet1", "wallet2"],
    };
    await expect(listener.handleAgreementCreated(data)).resolves.not.toThrow();
  });
});
