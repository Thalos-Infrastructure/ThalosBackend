import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { ApiClient } from '../common/api/api-client';
import { WalletsService } from './wallets.service';
import { LinkWalletDto } from './dto/wallets.dto';

const USER_ID = 'user-1';
const G_ADDRESS = 'GCIQLYVY7QA7NASMJDNH27UQANK6Q5E2IT6QZLXCKDIYGC3YAB7P5SC4';
const C_ADDRESS = 'CCV4UYUFZBD5CZDXZTZU47VFLWPKWRJLEWDICJAUNRZLETX63GJ4UAHW';

interface MockState {
  /** auth_users.wallet_public_key for USER_ID (undefined = no row). */
  authUserWallet?: string;
  /** First user_wallets insert fails with PGRST204 (identity columns missing). */
  failFirstInsertWithPgrst204?: boolean;
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
  let insertCalls = 0;
  const client = {
    from(table: string) {
      let insertResult: { data: unknown; error: unknown } = { data: null, error: null };
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        maybeSingle: async () => {
          if (table === 'auth_users') {
            return {
              data:
                state.authUserWallet === undefined
                  ? null
                  : { wallet_public_key: state.authUserWallet },
              error: null,
            };
          }
          return { data: null, error: null }; // no existing user_wallets link
        },
        insert: (row: Record<string, unknown>) => {
          insertCalls += 1;
          state.inserts.push(row);
          insertResult =
            state.failFirstInsertWithPgrst204 && insertCalls === 1
              ? { data: null, error: { code: 'PGRST204', message: 'column not found' } }
              : { data: { id: 'wallet-row-1', ...row }, error: null };
          return builder;
        },
        single: async () => insertResult,
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
  } as LinkWalletDto;
}

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

  it('rejects an accesly link when the G-address does not match the JWT user wallet', async () => {
    const state: MockState = { authUserWallet: 'GOTHERWALLET', inserts: [], updates: [] };
    const service = makeService(state);

    await expect(service.linkWallet(USER_ID, acceslyDto())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('falls back to the base row (no identity columns) on PGRST204 and still links', async () => {
    const state: MockState = {
      authUserWallet: G_ADDRESS,
      failFirstInsertWithPgrst204: true,
      inserts: [],
      updates: [],
    };
    const service = makeService(state);

    const { wallet, error } = await service.linkWallet(USER_ID, acceslyDto());

    expect(error).toBeNull();
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[0]).toMatchObject({ auth_provider: 'accesly', c_address: C_ADDRESS });
    expect(state.inserts[1]).not.toHaveProperty('auth_provider');
    expect(state.inserts[1]).not.toHaveProperty('c_address');
    expect(wallet).toMatchObject({ wallet_address: G_ADDRESS, wallet_type: 'accesly' });
  });
});
