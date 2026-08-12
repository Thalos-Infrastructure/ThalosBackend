import { BadRequestException } from '@nestjs/common';
import { createEscrow } from './escrow-write.helper';

jest.mock('./trustless-relay.helper', () => ({
  relayToTrustless: jest.fn().mockResolvedValue({ status: 200, data: { success: true } }),
}));

describe('createEscrow — single-release validation', () => {
  it('valida correctamente un payload single-release sin amount por milestone', async () => {
    const dto = {
      title: 'Test escrow',
      description: 'desc',
      amount: '100.00',
      platformFee: '0',
      signer: 'GTEST...',
      serviceType: 'single-release',
      roles: { approver: 'A', serviceProvider: 'B', releaseSigner: 'C', receiver: 'D' },
      milestones: [{ description: 'Full delivery' }],
    };

    await expect(createEscrow(dto as any)).resolves.toBeDefined();
  });

  it('rechaza un payload single-release sin amount raíz', () => {
    const dto = {
      title: 'Test escrow',
      description: 'desc',
      amount: '0.00',
      platformFee: '0',
      signer: 'GTEST...',
      serviceType: 'single-release',
      roles: { approver: 'A', serviceProvider: 'B', releaseSigner: 'C', receiver: 'D' },
      milestones: [{ description: 'Full delivery' }],
    };

    expect(() => createEscrow(dto as any)).toThrow(BadRequestException);
  });
});
