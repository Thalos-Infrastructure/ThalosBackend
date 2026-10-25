import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RampsService } from './ramps.service';
import { SupabaseService } from '../supabase/supabase.service';
import type { LendaraClient, LendaraTransaction } from './lendara.client';

const AGREEMENT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const MY_WALLET = 'GMINE0000000000000000000000000000000000000000000000000000';
const OTHER_WALLET = 'GOTHER000000000000000000000000000000000000000000000000000';
/** The issuer the escrows use on testnet. */
const ESCROW_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
/** Lendara's own sandbox issuer — a different asset despite the same code. */
const LENDARA_ISSUER = 'GBVIQ7QVTESTISSUER00000000000000000000000000000000000000';

function buildService(options: {
  ownedWallets?: string[];
  payerWallet?: string | null;
  isParticipant?: boolean;
  agreementExists?: boolean;
  transaction?: LendaraTransaction;
}) {
  const {
    ownedWallets = [MY_WALLET],
    payerWallet = MY_WALLET,
    isParticipant = true,
    agreementExists = true,
    transaction = {},
  } = options;

  const createSession = jest
    .fn()
    .mockResolvedValue({ id: 'sess_1', url: 'https://lendara/widget/sess_1' });
  const getTransaction = jest.fn().mockResolvedValue(transaction);

  const client = {
    from: (table: string) => {
      if (table === 'agreements') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: agreementExists ? { id: AGREEMENT, created_by: 'GCREATOR' } : null,
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'user_wallets') {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: ownedWallets.map((w) => ({ wallet_address: w, is_primary: true })),
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'auth_users') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          }),
        };
      }
      // agreement_participants: read twice — by userCanAccessAgreement
      // (.eq.in.limit) and to find the payer (.eq).
      return {
        select: () => ({
          eq: (_col: string, _val: string) => {
            const rows = payerWallet ? [{ wallet_address: payerWallet, role: 'payer' }] : [];
            const promise = Promise.resolve({ data: rows, error: null });
            return Object.assign(promise, {
              in: () => ({
                limit: () =>
                  Promise.resolve({
                    data: isParticipant ? [{ wallet_address: ownedWallets[0] }] : [],
                    error: null,
                  }),
              }),
            });
          },
        }),
      };
    },
  };

  const service = new RampsService(
    { getClient: () => client } as unknown as SupabaseService,
    { createSession, getTransaction } as unknown as LendaraClient,
  );

  return { service, createSession, getTransaction };
}

describe('RampsService — the browser never picks the destination', () => {
  it('derives the wallet from the agreement, not from the request', async () => {
    const { service, createSession } = buildService({});

    await service.createSession(USER, {
      agreementId: AGREEMENT,
      fiatCurrency: 'CRC',
      amount: '25000',
    });

    expect(createSession).toHaveBeenCalledWith({
      account: MY_WALLET,
      fiat_currency: 'CRC',
      amount: '25000',
    });
  });

  it("refuses to pay into the payer's wallet when the caller does not own it", async () => {
    // Otherwise any participant could start a session that funds someone
    // else's address with their own money.
    const { service, createSession } = buildService({
      ownedWallets: [OTHER_WALLET],
      payerWallet: MY_WALLET,
    });

    await expect(
      service.createSession(USER, {
        agreementId: AGREEMENT,
        fiatCurrency: 'CRC',
        amount: '25000',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(createSession).not.toHaveBeenCalled();
  });

  it('refuses someone who is not in the agreement', async () => {
    const { service, createSession } = buildService({
      isParticipant: false,
      payerWallet: null,
      ownedWallets: [OTHER_WALLET],
    });

    await expect(
      service.createSession(USER, {
        agreementId: AGREEMENT,
        fiatCurrency: 'CRC',
        amount: '25000',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('refuses an agreement that does not exist', async () => {
    const { service } = buildService({ agreementExists: false });

    await expect(
      service.createSession(USER, {
        agreementId: AGREEMENT,
        fiatCurrency: 'CRC',
        amount: '25000',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('RampsService — verification', () => {
  const completed = (overrides: Partial<LendaraTransaction> = {}): LendaraTransaction => ({
    status: 'completed',
    destination: MY_WALLET,
    stellar_transaction_id: 'abc123',
    asset_code: 'USDC',
    asset_issuer: ESCROW_ISSUER,
    ...overrides,
  });

  const verify = (service: RampsService) =>
    service.verify(USER, { agreementId: AGREEMENT, sessionId: 'sess_1' });

  it('confirms a deposit that landed in the expected wallet', async () => {
    const { service } = buildService({ transaction: completed() });

    await expect(verify(service)).resolves.toMatchObject({
      verified: true,
      stellarTransactionId: 'abc123',
      usableForEscrow: true,
    });
  });

  it('refuses a deposit that went somewhere else', async () => {
    // The destination is recomputed, so a session created for another wallet
    // — or someone else's transaction id — cannot pass as this user's.
    const { service } = buildService({
      transaction: completed({ destination: OTHER_WALLET }),
    });

    await expect(verify(service)).resolves.toMatchObject({
      verified: false,
      reason: 'The deposit went to a different wallet',
    });
  });

  it('refuses while the deposit is still in progress', async () => {
    const { service } = buildService({ transaction: completed({ status: 'pending' }) });

    await expect(verify(service)).resolves.toMatchObject({ verified: false });
  });

  it('refuses a transaction whose shape it cannot read', async () => {
    // Lendara's response shape is not confirmed against a live run yet.
    // Anything unrecognised has to fail closed rather than read as success.
    for (const tx of [
      {},
      { status: 'completed' },
      completed({ stellar_transaction_id: undefined }),
    ]) {
      const { service } = buildService({ transaction: tx });
      await expect(verify(service)).resolves.toMatchObject({ verified: false });
    }
  });

  it('separates "the money arrived" from "the money can fund the escrow"', async () => {
    // Lendara's sandbox USDC has its own issuer. Same code, different asset:
    // it reaches the wallet but the escrow will not take it.
    const { service } = buildService({
      transaction: completed({ asset_issuer: LENDARA_ISSUER }),
    });

    await expect(verify(service)).resolves.toMatchObject({
      verified: true,
      usableForEscrow: false,
    });
  });
});
