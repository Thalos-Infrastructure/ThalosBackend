import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { ApiClient } from '../common/api/api-client';
import { WalletsService } from './wallets.service';
import { LinkWalletDto } from './dto/wallets.dto';

const USER_ID = 'user-1';
const G_ADDRESS = 'GCIQLYVY7QA7NASMJDNH27UQANK6Q5E2IT6QZLXCKDIYGC3YAB7P5SC4';
const C_ADDRESS = 'CCV4UYUFZBD5CZDXZTZU47VFLWPKWRJLEWDICJAUNRZLETX63GJ4UAHW';
const POLLAR_USER_ID = 'cms7zi5yd00930ilc8vx3nf4u';

interface MockState {
  /** auth_users.wallet_public_key for USER_ID (undefined = no row). */
  authUserWallet?: string;
  /** auth_users.pollar_user_id for USER_ID — the identity the login recorded. */
  authUserPollarId?: string;
  /** The auth_users lookup fails instead of returning a row. */
  authUserQueryFails?: boolean;
  /** Columns user_wallets does not have yet; an insert naming one fails PGRST204. */
  missingColumns?: string[];
  inserts: Record<string, unknown>[];
  updates: { table: string; row: Record<string, unknown> }[];
}

/**
 * Minimal chainable Supabase mock covering exactly what linkWallet uses:
 *  - user_wallets: select().eq().eq().maybeSingle()  → no existing link
 *  - user_wallets: select(count, head)               → awaited thenable
 *  - auth_users:   select().eq().maybeSingle()       → JWT user's wallet
 *  - user_wallets: insert().select().single()        → captures rows
 *  - auth_users:   update().eq()                     → captures wallet_provider
 */
function makeSupabase(state: MockState): SupabaseService {
  const client = {
    from(table: string) {
      let insertResult: { data: unknown; error: unknown } = { data: null, error: null };
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        maybeSingle: () => {
          if (table === 'auth_users') {
            if (state.authUserQueryFails) {
              return Promise.resolve({
                data: null,
                error: { code: '08006', message: 'connection failure' },
              });
            }
            return Promise.resolve({
              data:
                state.authUserWallet === undefined
                  ? null
                  : {
                      wallet_public_key: state.authUserWallet,
                      pollar_user_id: state.authUserPollarId ?? null,
                    },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null }); // no existing user_wallets link
        },
        insert: (row: Record<string, unknown>) => {
          state.inserts.push(row);
          const missing = (state.missingColumns ?? []).find((column) => column in row);
          insertResult = missing
            ? { data: null, error: { code: 'PGRST204', message: `column ${missing} not found` } }
            : { data: { id: 'wallet-row-1', ...row }, error: null };
          return builder;
        },
        single: () => Promise.resolve(insertResult),
        update: (row: Record<string, unknown>) => {
          state.updates.push({ table, row });
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null, count: 0 }).then(resolve),
      });
      return builder;
    },
  };
  return { getClient: () => client } as unknown as SupabaseService;
}

function makeService(state: MockState): WalletsService {
  const config = { get: () => 'testnet' } as unknown as ConfigService;
  return new WalletsService(makeSupabase(state), config, {} as ApiClient);
}

function acceslyDto(overrides: Partial<LinkWalletDto> = {}): LinkWalletDto {
  return {
    wallet_address: G_ADDRESS,
    wallet_type: 'accesly',
    c_address: C_ADDRESS,
    ...overrides,
  };
}

function pollarExternalDto(overrides: Partial<LinkWalletDto> = {}): LinkWalletDto {
  return {
    wallet_address: G_ADDRESS,
    // A wallet the user brought: its own type, not 'custodial'.
    wallet_type: 'freighter',
    auth_provider: 'pollar',
    pollar_user_id: POLLAR_USER_ID,
    ...overrides,
  };
}

function pollarCustodialDto(overrides: Partial<LinkWalletDto> = {}): LinkWalletDto {
  return {
    wallet_address: G_ADDRESS,
    // Pollar's main path: wallet.type 'internal', so Pollar holds the key.
    wallet_type: 'custodial',
    auth_provider: 'pollar',
    pollar_user_id: POLLAR_USER_ID,
    ...overrides,
  };
}

describe('WalletsService.linkWallet — a Pollar identity is checked, not believed', () => {
  it('records a provisioned wallet when both halves match what the login wrote', async () => {
    const state: MockState = {
      authUserWallet: G_ADDRESS,
      authUserPollarId: POLLAR_USER_ID,
      inserts: [],
      updates: [],
    };
    const service = makeService(state);

    const { wallet, error } = await service.linkWallet(USER_ID, pollarCustodialDto());

    expect(error).toBeNull();
    expect(wallet).toMatchObject({
      wallet_type: 'custodial',
      auth_provider: 'pollar',
      pollar_user_id: POLLAR_USER_ID,
      is_verified: true,
    });
  });

  it("refuses a custodial wallet claiming another user's Pollar id", async () => {
    // The hole this closes: 'custodial' is checked first in the branch chain and
    // used to prove nothing, so the very same body refused as 'freighter' was
    // stored — attributing the caller's wallet to someone else's Pollar identity,
    // which is exactly what scripts/013's reverse-lookup index reads back.
    const state: MockState = {
      authUserWallet: G_ADDRESS,
      authUserPollarId: POLLAR_USER_ID,
      inserts: [],
      updates: [],
    };
    const service = makeService(state);

    await expect(
      service.linkWallet(USER_ID, pollarCustodialDto({ pollar_user_id: 'someone-elses-id' })),
    ).rejects.toThrow(/pollar_user_id does not match/);
    expect(state.inserts).toHaveLength(0);
  });

  it('refuses a custodial wallet the authenticated user did not log in with', async () => {
    const state: MockState = {
      authUserWallet: 'GOTHERADDRESS',
      authUserPollarId: POLLAR_USER_ID,
      inserts: [],
      updates: [],
    };
    const service = makeService(state);

    await expect(service.linkWallet(USER_ID, pollarCustodialDto())).rejects.toThrow(
      /Pollar wallet does not match/,
    );
    expect(state.inserts).toHaveLength(0);
  });

  it('refuses a Pollar id when the account has none recorded', async () => {
    // No pollar_user_id on auth_users means no Pollar login ever proved one, so
    // there is nothing to check the claim against and it cannot be accepted.
    const state: MockState = { authUserWallet: G_ADDRESS, inserts: [], updates: [] };
    const service = makeService(state);

    await expect(service.linkWallet(USER_ID, pollarCustodialDto())).rejects.toThrow(
      /pollar_user_id does not match/,
    );
  });

  it("refuses an external wallet claiming another user's Pollar id", async () => {
    const state: MockState = {
      authUserWallet: G_ADDRESS,
      authUserPollarId: POLLAR_USER_ID,
      inserts: [],
      updates: [],
    };
    const service = makeService(state);

    await expect(
      service.linkWallet(USER_ID, pollarExternalDto({ pollar_user_id: 'someone-elses-id' })),
    ).rejects.toThrow(/pollar_user_id does not match/);
    expect(state.inserts).toHaveLength(0);
  });

  it('refuses an Accesly provider on a custodial wallet', async () => {
    // An Accesly wallet links as wallet_type 'accesly', where c_address and the
    // address check are required; claiming the provider on a custodial row skips
    // both and asserts an origin the wallet does not have.
    const state: MockState = { authUserWallet: G_ADDRESS, inserts: [], updates: [] };
    const service = makeService(state);

    await expect(
      service.linkWallet(
        USER_ID,
        pollarCustodialDto({ auth_provider: 'accesly', pollar_user_id: undefined }),
      ),
    ).rejects.toThrow(/requires wallet_type 'accesly'/);
    expect(state.inserts).toHaveLength(0);
  });
});

describe('WalletsService.linkWallet — wallet authenticated through Pollar (#108)', () => {
  it("accepts Pollar's proof instead of a SEP-0043 signature", async () => {
    const state: MockState = {
      authUserWallet: G_ADDRESS,
      authUserPollarId: POLLAR_USER_ID,
      inserts: [],
      updates: [],
    };
    const service = makeService(state);

    const { wallet, error } = await service.linkWallet(USER_ID, pollarExternalDto());

    expect(error).toBeNull();
    expect(wallet).toMatchObject({
      wallet_address: G_ADDRESS,
      wallet_type: 'freighter',
      auth_provider: 'pollar',
      pollar_user_id: POLLAR_USER_ID,
      is_verified: true,
    });
  });

  it('refuses a wallet the authenticated user did not log in with', async () => {
    // The proof IS auth_users.wallet_public_key, written by the login route
    // after Pollar's SEP-10. A mismatch means the caller is claiming someone
    // else's address, which is exactly what the signature would have caught.
    const state: MockState = { authUserWallet: 'GOTHERADDRESS', inserts: [], updates: [] };
    const service = makeService(state);

    await expect(service.linkWallet(USER_ID, pollarExternalDto())).rejects.toThrow(
      /does not match the authenticated user/,
    );
  });

  it('reports a failed auth_users lookup as a server error, not as a mismatch', async () => {
    // Discarding the query error would surface a database failure as 403 'does
    // not match', blaming the caller for something they did not do.
    const state: MockState = { authUserQueryFails: true, inserts: [], updates: [] };
    const service = makeService(state);

    await expect(service.linkWallet(USER_ID, pollarExternalDto())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(state.inserts).toHaveLength(0);
  });

  it('refuses to record a Pollar provider without the Pollar user id', async () => {
    const state: MockState = { authUserWallet: G_ADDRESS, inserts: [], updates: [] };
    const service = makeService(state);

    await expect(
      service.linkWallet(USER_ID, pollarExternalDto({ pollar_user_id: undefined })),
    ).rejects.toThrow(/requires pollar_user_id/);
  });
});

describe('WalletsService.linkWallet — accesly identity (#109)', () => {
  it('persists auth_provider + c_address and marks the wallet verified', async () => {
    const state: MockState = { authUserWallet: G_ADDRESS, inserts: [], updates: [] };
    const service = makeService(state);

    const { wallet, error } = await service.linkWallet(USER_ID, acceslyDto());

    expect(error).toBeNull();
    expect(wallet).toMatchObject({
      wallet_address: G_ADDRESS,
      wallet_type: 'accesly',
      auth_provider: 'accesly',
      c_address: C_ADDRESS,
      is_verified: true,
    });
  });

  it('writes auth_users.wallet_provider so /api/auth/me echoes the login method', async () => {
    const state: MockState = { authUserWallet: G_ADDRESS, inserts: [], updates: [] };
    const service = makeService(state);

    await service.linkWallet(USER_ID, acceslyDto());

    expect(state.updates).toContainEqual({
      table: 'auth_users',
      row: { wallet_provider: 'accesly' },
    });
  });

  it('rejects an accesly link without c_address', async () => {
    const state: MockState = { authUserWallet: G_ADDRESS, inserts: [], updates: [] };
    const service = makeService(state);

    await expect(
      service.linkWallet(USER_ID, acceslyDto({ c_address: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an accesly wallet that claims a different provider', async () => {
    const state: MockState = { authUserWallet: G_ADDRESS, inserts: [], updates: [] };
    const service = makeService(state);

    await expect(
      service.linkWallet(USER_ID, acceslyDto({ auth_provider: 'pollar' })),
    ).rejects.toThrow(/auth_provider must be 'accesly'/);
    expect(state.inserts).toHaveLength(0);
  });

  it('refuses a pollar_user_id on an accesly wallet', async () => {
    const state: MockState = { authUserWallet: G_ADDRESS, inserts: [], updates: [] };
    const service = makeService(state);

    await expect(
      service.linkWallet(USER_ID, acceslyDto({ pollar_user_id: 'cms7zi5yd00930ilc8vx3nf4u' })),
    ).rejects.toThrow(/pollar_user_id is not valid/);
    expect(state.inserts).toHaveLength(0);
  });

  it('accepts an accesly wallet that echoes its own provider back', async () => {
    const state: MockState = { authUserWallet: G_ADDRESS, inserts: [], updates: [] };
    const service = makeService(state);

    const { wallet, error } = await service.linkWallet(
      USER_ID,
      acceslyDto({ auth_provider: 'accesly' }),
    );

    expect(error).toBeNull();
    expect(wallet).toMatchObject({ auth_provider: 'accesly' });
  });

  it('rejects an accesly link when the G-address does not match the JWT user wallet', async () => {
    const state: MockState = { authUserWallet: 'GOTHERWALLET', inserts: [], updates: [] };
    const service = makeService(state);

    await expect(service.linkWallet(USER_ID, acceslyDto())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('keeps auth_provider when only pollar_user_id is missing (008 applied, 013 pending)', async () => {
    // The state this branch deploys into. Dropping the whole identity here would
    // store a row indistinguishable from an external wallet while
    // auth_users.wallet_provider says 'pollar' — the two tables disagreeing, with
    // a console.warn as the only trace.
    const state: MockState = {
      authUserWallet: G_ADDRESS,
      authUserPollarId: POLLAR_USER_ID,
      missingColumns: ['pollar_user_id'],
      inserts: [],
      updates: [],
    };
    const service = makeService(state);

    const { wallet, error } = await service.linkWallet(USER_ID, pollarCustodialDto());

    expect(error).toBeNull();
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[0]).toHaveProperty('pollar_user_id', POLLAR_USER_ID);
    expect(state.inserts[1]).not.toHaveProperty('pollar_user_id');
    expect(state.inserts[1]).toHaveProperty('auth_provider', 'pollar');
    expect(wallet).toMatchObject({ auth_provider: 'pollar' });
  });

  it('falls back to the base row (no identity columns) on PGRST204 and still links', async () => {
    const state: MockState = {
      authUserWallet: G_ADDRESS,
      missingColumns: ['auth_provider', 'pollar_user_id', 'c_address'],
      inserts: [],
      updates: [],
    };
    const service = makeService(state);

    const { wallet, error } = await service.linkWallet(USER_ID, acceslyDto());

    expect(error).toBeNull();
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[0]).toMatchObject({ auth_provider: 'accesly', c_address: C_ADDRESS });
    expect(state.inserts[1]).not.toHaveProperty('auth_provider');
    expect(state.inserts[1]).not.toHaveProperty('pollar_user_id');
    expect(state.inserts[1]).not.toHaveProperty('c_address');
    expect(wallet).toMatchObject({ wallet_address: G_ADDRESS, wallet_type: 'accesly' });
  });
});
