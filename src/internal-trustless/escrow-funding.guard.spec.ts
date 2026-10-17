import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { assertEscrowFunded } from './escrow-funding.guard';
import * as relayHelper from './trustless-relay.helper';

jest.mock('./trustless-relay.helper');

const mockedRelay = relayHelper.relayToTrustless as jest.Mock;
const CONTRACT = 'CA6DQZDLRYWF2M5QMQV744BWVSX3LM72M54R5XDZDWJ7WF32TS2SAG3F';

function tw(status: number, data: unknown) {
  return Promise.resolve({ status, data });
}

describe('assertEscrowFunded', () => {
  beforeEach(() => mockedRelay.mockReset());

  it('reads the escrow by contract id, validated on chain', async () => {
    mockedRelay.mockReturnValueOnce(tw(200, [{ contractId: CONTRACT, balance: 15 }]));

    await assertEscrowFunded(CONTRACT);

    expect(mockedRelay).toHaveBeenCalledWith('GET', 'helper/get-escrow-by-contract-ids', {
      'contractIds[]': CONTRACT,
      validateOnChain: true,
    });
  });

  it('accepts a funded escrow', async () => {
    mockedRelay.mockReturnValueOnce(tw(200, [{ contractId: CONTRACT, balance: 15 }]));
    await expect(assertEscrowFunded(CONTRACT)).resolves.toBeUndefined();
  });

  it('rejects an escrow with no balance (the CA6DQZ… case)', async () => {
    mockedRelay.mockReturnValueOnce(tw(200, [{ contractId: CONTRACT, balance: 0, amount: 15 }]));
    await expect(assertEscrowFunded(CONTRACT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the balance is missing rather than assuming funds', async () => {
    mockedRelay.mockReturnValueOnce(tw(200, [{ contractId: CONTRACT }]));
    await expect(assertEscrowFunded(CONTRACT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails closed when Trustless Work errors', async () => {
    mockedRelay.mockReturnValueOnce(tw(500, {}));
    await expect(assertEscrowFunded(CONTRACT)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails closed when the escrow is not indexed yet', async () => {
    mockedRelay.mockReturnValueOnce(tw(200, []));
    await expect(assertEscrowFunded(CONTRACT)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
