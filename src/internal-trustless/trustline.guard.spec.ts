import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { assertRecipientsCanReceive } from './trustline.guard';

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const PAYER = 'GPAYER000000000000000000000000000000000000000000000000000';
const PAYEE = 'GPAYEE000000000000000000000000000000000000000000000000000';

const withTrustline = {
  balances: [
    { asset_type: 'native', balance: '5' },
    { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: ISSUER, balance: '0' },
  ],
};
const withoutTrustline = { balances: [{ asset_type: 'native', balance: '5' }] };

/** Horizon replies keyed by address, so each test says what the ledger holds. */
function mockHorizon(byAddress: Record<string, { status: number; body?: unknown }>) {
  global.fetch = jest.fn((input: Parameters<typeof fetch>[0]) => {
    // `input` can be a Request, which stringifies to [object Object].
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const address = url.split('/accounts/')[1];
    const reply = byAddress[address];
    if (!reply) throw new Error(`unexpected address ${address}`);
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body ?? {}),
    } as Response);
  });
}

describe('assertRecipientsCanReceive', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('passes when every recipient holds the trustline', async () => {
    mockHorizon({
      [PAYER]: { status: 200, body: withTrustline },
      [PAYEE]: { status: 200, body: withTrustline },
    });

    await expect(assertRecipientsCanReceive([PAYER, PAYEE])).resolves.toBeUndefined();
  });

  it('counts a zero balance as held — the line existing is what matters', async () => {
    mockHorizon({ [PAYEE]: { status: 200, body: withTrustline } });
    await expect(assertRecipientsCanReceive([PAYEE])).resolves.toBeUndefined();
  });

  it('names the recipient that cannot receive', async () => {
    // The resolver cannot fix this — only the holder of that address can — so
    // the error has to say whose problem it is.
    mockHorizon({
      [PAYER]: { status: 200, body: withTrustline },
      [PAYEE]: { status: 200, body: withoutTrustline },
    });

    await expect(assertRecipientsCanReceive([PAYER, PAYEE])).rejects.toThrow(BadRequestException);

    try {
      await assertRecipientsCanReceive([PAYER, PAYEE]);
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as {
        code: string;
        problems: { address: string; reason: string }[];
      };
      expect(body.code).toBe('TRUSTLINE_MISSING');
      expect(body.problems).toEqual([{ address: PAYEE, reason: 'missing' }]);
    }
  });

  it('tells an unfunded account apart from one missing the trustline', async () => {
    // Different fixes: one needs the account created, the other a trustline.
    mockHorizon({ [PAYEE]: { status: 404 } });

    try {
      await assertRecipientsCanReceive([PAYEE]);
      fail('should have thrown');
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as {
        problems: { reason: string }[];
      };
      expect(body.problems[0].reason).toBe('no-account');
    }
  });

  it('reports every problem at once, not the first one', async () => {
    mockHorizon({
      [PAYER]: { status: 404 },
      [PAYEE]: { status: 200, body: withoutTrustline },
    });

    try {
      await assertRecipientsCanReceive([PAYER, PAYEE]);
      fail('should have thrown');
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as { problems: unknown[] };
      expect(body.problems).toHaveLength(2);
    }
  });

  it('fails closed when Horizon cannot be reached', async () => {
    // Letting it through would spend the resolver's signature on a submit that
    // bounces; a 503 can simply be retried.
    global.fetch = jest.fn(() => Promise.reject(new Error('network')));

    await expect(assertRecipientsCanReceive([PAYEE])).rejects.toThrow(ServiceUnavailableException);
  });

  it('fails closed on a Horizon error status', async () => {
    mockHorizon({ [PAYEE]: { status: 500 } });
    await expect(assertRecipientsCanReceive([PAYEE])).rejects.toThrow(ServiceUnavailableException);
  });

  it('checks each address once, however often it appears', async () => {
    mockHorizon({ [PAYEE]: { status: 200, body: withTrustline } });

    await assertRecipientsCanReceive([PAYEE, ` ${PAYEE} `, PAYEE]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there are no recipients to check', async () => {
    global.fetch = jest.fn();

    await expect(assertRecipientsCanReceive([])).resolves.toBeUndefined();
    await expect(assertRecipientsCanReceive(['', '  '])).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores a USDC balance from a different issuer', async () => {
    // Same code, other asset: it cannot receive the escrow's USDC.
    mockHorizon({
      [PAYEE]: {
        status: 200,
        body: {
          balances: [{ asset_code: 'USDC', asset_issuer: 'GSOMEONEELSE', balance: '100' }],
        },
      },
    });

    await expect(assertRecipientsCanReceive([PAYEE])).rejects.toThrow(BadRequestException);
  });
});
