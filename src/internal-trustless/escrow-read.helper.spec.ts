import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as relayHelper from './trustless-relay.helper';
import {
  assertResolvable,
  readEscrow,
  resolutionTotal,
  type EscrowSnapshot,
} from './escrow-read.helper';

jest.mock('./trustless-relay.helper');

const mockedRelay = relayHelper.relayToTrustless as jest.Mock;

const RESOLVER = 'GB6MP3L6UGIDY6O6MXNLSKHLXT2T2TCMPZIZGUTOGYKOLHW7EORWMFCK';
const APPROVER = 'GAQGVX77PX3UAQCJKXFAYDRFHRCPLTNGMMNEUCENZ525SBW4EYWGRGNK';
const PROVIDER = 'GAVQBYRJHPMP4IC4GS7LAASA5DKYYX7WPH5KSNMSYRNO7S6LG53LLLB5';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/**
 * A real `get-escrow-by-contract-ids` payload, captured from the Trustless Work
 * dev API on 2026-10-18. Not hand-written: the fields this parser reads are the
 * ones the service actually sends, in the types it actually sends them in.
 */
const liveEscrow = {
  contractId: 'CDIVGKL6K7FVBJ3KVTHGB6VVRDT3TAXT2LMYYN2LLSUUG2WEXV2E57YE',
  contractBaseId: 'CDHBR6AFWLSLZGAQSXGYRBUEMZHV4AYHH7EAXVOU5VKOV3P5LSERR37D',
  signer: APPROVER,
  type: 'single-release',
  engagementId: 'THALOS-v2-SINGLERELEASE-MVBTWLH5',
  title: 'Test agreement',
  description: 'something',
  amount: 100,
  platformFee: 0,
  roles: {
    approver: APPROVER,
    serviceProvider: PROVIDER,
    platformAddress: 'GBTTKTSBLHGMRY3T65JXT423MHQZXTD26TTHQEY5HNF2KWFFDKKVHVPD',
    releaseSigner: APPROVER,
    disputeResolver: RESOLVER,
    receiver: PROVIDER,
  },
  flags: { disputed: false, released: false, resolved: false },
  trustline: {
    address: ISSUER,
    contractId: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    symbol: 'USDC',
  },
  milestones: [{ description: 'Full delivery', status: 'pending', evidence: '', approved: false }],
  isActive: true,
  balance: 0,
};

const ok = (data: unknown) => Promise.resolve({ status: 200, data });

describe('readEscrow', () => {
  beforeEach(() => mockedRelay.mockReset());

  it('asks Trustless Work for the one contract, validated on chain', async () => {
    // `contractIds` on its own is answered with "contractIds must be an array",
    // whatever the OpenAPI spec names the parameter.
    mockedRelay.mockReturnValueOnce(ok([liveEscrow]));

    await readEscrow(liveEscrow.contractId);

    expect(mockedRelay).toHaveBeenCalledWith('GET', 'helper/get-escrow-by-contract-ids', {
      'contractIds[]': liveEscrow.contractId,
      validateOnChain: true,
    });
  });

  it('reads the fields a resolution depends on from a live payload', async () => {
    mockedRelay.mockReturnValueOnce(ok([liveEscrow]));

    const escrow = await readEscrow(liveEscrow.contractId);

    expect(escrow).toMatchObject({
      contractId: liveEscrow.contractId,
      type: 'single-release',
      amount: 100,
      balance: 0,
      roles: { approver: APPROVER, serviceProvider: PROVIDER, disputeResolver: RESOLVER },
      flags: { disputed: false, released: false, resolved: false },
      trustline: { address: ISSUER, symbol: 'USDC' },
    });
  });

  it('keeps a balance of 0 as 0, not as missing', async () => {
    // An unfunded escrow and an escrow whose balance we failed to read need
    // different answers, and `resolutionTotal` refuses on the first.
    mockedRelay.mockReturnValueOnce(ok([{ ...liveEscrow, balance: 0 }]));

    await expect(readEscrow('C1')).resolves.toMatchObject({ balance: 0 });
  });

  it('accepts a numeric string balance without turning it into NaN', async () => {
    mockedRelay.mockReturnValueOnce(ok([{ ...liveEscrow, balance: '15.5', amount: '100' }]));

    await expect(readEscrow('C1')).resolves.toMatchObject({ balance: 15.5, amount: 100 });
  });

  it('leaves a milestone without an amount undefined rather than zero', async () => {
    // Single-release milestones carry no amount at all; reading that as 0 would
    // make a multi-release resolution silently distribute nothing.
    mockedRelay.mockReturnValueOnce(ok([liveEscrow]));

    const escrow = await readEscrow('C1');

    expect(escrow.milestones[0].amount).toBeUndefined();
  });

  it('reads a single escrow returned outside an array', async () => {
    mockedRelay.mockReturnValueOnce(ok(liveEscrow));

    await expect(readEscrow('C1')).resolves.toMatchObject({ type: 'single-release' });
  });

  it('is a 404 when the contract is not indexed', async () => {
    mockedRelay.mockReturnValueOnce(ok([]));

    await expect(readEscrow('C1')).rejects.toThrow(NotFoundException);
  });

  it('is a 503 when Trustless Work is down, so the caller may retry', async () => {
    mockedRelay.mockReturnValueOnce(Promise.resolve({ status: 503, data: {} }));

    await expect(readEscrow('C1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('passes an upstream 4xx through as a 400', async () => {
    mockedRelay.mockReturnValueOnce(
      Promise.resolve({ status: 400, data: { message: 'bad contract id' } }),
    );

    await expect(readEscrow('C1')).rejects.toThrow(BadRequestException);
  });
});

const snapshot = (overrides: Partial<EscrowSnapshot> = {}): EscrowSnapshot => ({
  contractId: 'C1',
  type: 'single-release',
  amount: 100,
  balance: 15,
  roles: { approver: APPROVER, serviceProvider: PROVIDER, disputeResolver: RESOLVER },
  flags: { disputed: true, released: false, resolved: false },
  milestones: [{}],
  ...overrides,
});

describe('resolutionTotal', () => {
  it('splits the balance on single-release, not the agreed amount', () => {
    // The agreement says 100; the contract holds 15. Only the 15 can move.
    expect(resolutionTotal(snapshot(), 'single-release')).toBe(15);
  });

  it('refuses an escrow holding nothing', () => {
    expect(() => resolutionTotal(snapshot({ balance: 0 }), 'single-release')).toThrow(
      /nothing to distribute/,
    );
  });

  it('splits the milestone amount on multi-release', () => {
    const escrow = snapshot({
      type: 'multi-release',
      balance: 50,
      milestones: [{ amount: 10 }, { amount: 5 }],
    });

    expect(resolutionTotal(escrow, 'multi-release', '1')).toBe(5);
  });

  it('never exceeds what the contract actually holds', () => {
    // The milestone says 10 but only 4 was ever funded; distributing 10 would
    // be rejected on chain after the resolver had signed it.
    const escrow = snapshot({ type: 'multi-release', balance: 4, milestones: [{ amount: 10 }] });

    expect(resolutionTotal(escrow, 'multi-release', '0')).toBe(4);
  });

  it('refuses a milestone index that is not on the escrow', () => {
    const escrow = snapshot({ type: 'multi-release', milestones: [{ amount: 10 }] });

    for (const index of ['1', '-1', 'two', undefined]) {
      expect(() => resolutionTotal(escrow, 'multi-release', index)).toThrow(/does not exist/);
    }
  });

  it('refuses a milestone with no amount to split', () => {
    const escrow = snapshot({ type: 'multi-release', milestones: [{}] });

    expect(() => resolutionTotal(escrow, 'multi-release', '0')).toThrow(/no amount/);
  });
});

describe('assertResolvable', () => {
  const dto = { type: 'single-release' as const, disputeResolver: RESOLVER };

  it('allows the escrow dispute resolver on a disputed escrow', () => {
    expect(() => assertResolvable(snapshot(), dto)).not.toThrow();
  });

  it('ignores the case of the address', () => {
    expect(() =>
      assertResolvable(snapshot(), { ...dto, disputeResolver: RESOLVER.toLowerCase() }),
    ).not.toThrow();
  });

  it('refuses anyone who is not this escrow dispute resolver', () => {
    expect(() => assertResolvable(snapshot(), { ...dto, disputeResolver: APPROVER })).toThrow(
      /not the dispute resolver/,
    );
  });

  it('refuses an escrow that is not disputed', () => {
    const escrow = snapshot({ flags: { disputed: false, released: false, resolved: false } });

    expect(() => assertResolvable(escrow, dto)).toThrow(/not in dispute/);
  });

  it('refuses a dispute already resolved', () => {
    const escrow = snapshot({ flags: { disputed: true, released: false, resolved: true } });

    expect(() => assertResolvable(escrow, dto)).toThrow(/already resolved/);
  });

  it('refuses a request aimed at the wrong escrow type', () => {
    expect(() => assertResolvable(snapshot({ type: 'multi-release' }), dto)).toThrow(
      /not single-release/,
    );
  });

  describe('multi-release carries the dispute on the milestone', () => {
    const multi = (flags?: Record<string, boolean>) =>
      snapshot({
        type: 'multi-release',
        // The escrow-level flag stays false: on multi-release it is the
        // milestone that is disputed, so reading the escrow's own flag would
        // refuse every valid resolution.
        flags: { disputed: false, released: false, resolved: false },
        milestones: [{ amount: 10, ...(flags ? { flags } : {}) }],
      });

    const dto = { type: 'multi-release' as const, disputeResolver: RESOLVER, milestoneIndex: '0' };

    it('allows a disputed milestone', () => {
      expect(() =>
        assertResolvable(multi({ disputed: true, released: false, resolved: false }), dto),
      ).not.toThrow();
    });

    it('refuses a milestone nobody disputed', () => {
      expect(() =>
        assertResolvable(multi({ disputed: false, released: false, resolved: false }), dto),
      ).toThrow(/not in dispute/);
    });

    it('refuses a milestone already settled', () => {
      for (const flags of [
        { disputed: true, released: true, resolved: false },
        { disputed: true, released: false, resolved: true },
      ]) {
        expect(() => assertResolvable(multi(flags), dto)).toThrow(/already settled/);
      }
    });

    it('allows a milestone that reports no flags at all', () => {
      // Silence is not a refusal: an escrow shape this code has not seen must
      // not block a resolution that is perfectly valid.
      expect(() => assertResolvable(multi(), dto)).not.toThrow();
    });

    it('leaves an out-of-range index to resolutionTotal', () => {
      expect(() =>
        assertResolvable(multi({ disputed: true, released: false, resolved: false }), {
          ...dto,
          milestoneIndex: '9',
        }),
      ).not.toThrow();
    });
  });
});
