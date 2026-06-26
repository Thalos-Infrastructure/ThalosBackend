import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import {
  AgreementCreatedData,
  AgreementFundedData,
  AgreementCompletedData,
} from './types/notification-data.types';

describe('NotificationsListener', () => {
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
          },
        },
      ],
    }).compile();

    listener = module.get<NotificationsListener>(NotificationsListener);
    notificationsService = module.get(NotificationsService);
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
    expect(notificationsService.notifyAgreementCreated.mock.calls).toEqual([[data]]);
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
    expect(notificationsService.notifyAgreementFunded.mock.calls).toEqual([[data]]);
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
    expect(notificationsService.notifyAgreementCompleted.mock.calls).toEqual([[data]]);
  });

  it('should not throw error even if notification fails', async () => {
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
});
