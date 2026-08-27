/**
 * Regression: connecting a second wallet used to hide agreements created with
 * the first one, because access was resolved from the single
 * `auth_users.wallet_public_key` field.
 */
import { resolveUserWallets, userOwnsWallet, userCanAccessAgreement } from './resolve-user-wallets';

type Row = Record<string, unknown>;

function buildClient(tables: Record<string, Row[]>) {
  function chain(table: string) {
    const rows = tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];

    const api: Record<string, unknown> = {};
    const self = () => api;

    api.select = () => self();
    api.order = () => self();
    api.eq = (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return self();
    };
    api.in = (col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]));
      return self();
    };

    const matched = () => rows.filter((r) => filters.every((f) => f(r)));

    api.maybeSingle = () => Promise.resolve({ data: matched()[0] ?? null, error: null });
    api.limit = () => Promise.resolve({ data: matched(), error: null });
    (api as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: matched(), error: null }).then(resolve);

    return api;
  }

  return { from: (t: string) => chain(t) } as never;
}

describe('resolveUserWallets', () => {
  it('returns every wallet linked to the user, primary first', async () => {
    const client = buildClient({
      user_wallets: [
        { user_id: 'u1', wallet_address: 'GPRIMARY', is_primary: true },
        { user_id: 'u1', wallet_address: 'GSECOND', is_primary: false },
        { user_id: 'u2', wallet_address: 'GOTHER', is_primary: true },
      ],
      auth_users: [{ id: 'u1', wallet_public_key: 'GPRIMARY' }],
    });

    const wallets = await resolveUserWallets(client, 'u1');

    expect(wallets).toContain('GPRIMARY');
    expect(wallets).toContain('GSECOND');
    expect(wallets).not.toContain('GOTHER');
  });

  it('does not duplicate a wallet present in both tables', async () => {
    const client = buildClient({
      user_wallets: [{ user_id: 'u1', wallet_address: 'GSAME', is_primary: true }],
      auth_users: [{ id: 'u1', wallet_public_key: 'GSAME' }],
    });

    expect(await resolveUserWallets(client, 'u1')).toEqual(['GSAME']);
  });

  it('falls back to auth_users when the wallet was never backfilled', async () => {
    const client = buildClient({
      user_wallets: [],
      auth_users: [{ id: 'u1', wallet_public_key: 'GLEGACY' }],
    });

    expect(await resolveUserWallets(client, 'u1')).toEqual(['GLEGACY']);
  });

  it('returns an empty list for a user with no wallet at all', async () => {
    const client = buildClient({ user_wallets: [], auth_users: [] });

    expect(await resolveUserWallets(client, 'ghost')).toEqual([]);
  });
});

describe('userOwnsWallet', () => {
  const client = buildClient({
    user_wallets: [
      { user_id: 'u1', wallet_address: 'GA', is_primary: true },
      { user_id: 'u1', wallet_address: 'GB', is_primary: false },
    ],
    auth_users: [{ id: 'u1', wallet_public_key: 'GA' }],
  });

  it('accepts a non-primary wallet as a valid actor', async () => {
    expect(await userOwnsWallet(client, 'u1', 'GB')).toBe(true);
  });

  it('rejects a wallet the user does not own', async () => {
    expect(await userOwnsWallet(client, 'u1', 'GSTRANGER')).toBe(false);
  });
});

describe('userCanAccessAgreement', () => {
  const tables = {
    user_wallets: [
      { user_id: 'u1', wallet_address: 'GA', is_primary: true },
      { user_id: 'u1', wallet_address: 'GB', is_primary: false },
    ],
    auth_users: [{ id: 'u1', wallet_public_key: 'GA' }],
    agreement_participants: [{ agreement_id: 'agr-part', wallet_address: 'GB' }],
  };

  it('keeps access to an agreement created with another owned wallet', async () => {
    // The regression: created with GA while GB is now the connected wallet.
    const client = buildClient(tables);
    expect(await userCanAccessAgreement(client, 'u1', 'agr-1', 'GA')).toBe(true);
  });

  it('grants access when a secondary wallet is a participant', async () => {
    const client = buildClient(tables);
    expect(await userCanAccessAgreement(client, 'u1', 'agr-part', 'GCREATOR')).toBe(true);
  });

  it('denies access to an unrelated agreement', async () => {
    const client = buildClient(tables);
    expect(await userCanAccessAgreement(client, 'u1', 'agr-none', 'GCREATOR')).toBe(false);
  });

  it('denies access to a user with no wallets', async () => {
    const client = buildClient({ user_wallets: [], auth_users: [] });
    expect(await userCanAccessAgreement(client, 'ghost', 'agr-1', 'GA')).toBe(false);
  });
});
