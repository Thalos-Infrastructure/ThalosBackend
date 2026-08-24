import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Multi-wallet identity resolution.
 *
 * Historically a user was assumed to own exactly one wallet, read from
 * `auth_users.wallet_public_key`. That broke access to agreements as soon as a
 * user connected a second wallet: agreements are anchored to the wallet that
 * created them, so switching wallets made previous agreements invisible.
 *
 * `user_wallets` is the source of truth for wallet ownership. Rows only land
 * there after ownership has been proven (non-custodial links require a signed
 * challenge bound to both the user id and the address; custodial wallets are
 * created by the platform itself), so treating every row as owned does not
 * widen the trust boundary.
 *
 * `auth_users.wallet_public_key` is still unioned in as a legacy fallback so
 * users whose wallet was never backfilled into `user_wallets` keep their
 * access. Once the backfill has run everywhere the fallback can be dropped.
 */

/** Wallet addresses a user is allowed to act as, newest identity model first. */
export async function resolveUserWallets(
  client: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const wallets = new Set<string>();

  const { data: linked } = await client
    .from('user_wallets')
    .select('wallet_address, is_primary')
    .eq('user_id', userId)
    .order('is_primary', { ascending: false });

  for (const row of linked ?? []) {
    const address = (row as { wallet_address?: string | null }).wallet_address;
    if (address) wallets.add(address);
  }

  // Legacy fallback: single-wallet field on auth_users.
  const { data: legacy } = await client
    .from('auth_users')
    .select('wallet_public_key')
    .eq('id', userId)
    .maybeSingle();

  const legacyWallet = (legacy as { wallet_public_key?: string | null } | null)?.wallet_public_key;
  if (legacyWallet) wallets.add(legacyWallet);

  return [...wallets];
}

/**
 * True when `wallet` is one of the user's owned wallets. Used for actor checks
 * where the user may legitimately sign with any wallet they control.
 */
export async function userOwnsWallet(
  client: SupabaseClient,
  userId: string,
  wallet: string,
): Promise<boolean> {
  const wallets = await resolveUserWallets(client, userId);
  return wallets.includes(wallet);
}

/**
 * True when the user can read/act on the agreement, via any owned wallet:
 * either they created it, or one of their wallets is a participant.
 */
export async function userCanAccessAgreement(
  client: SupabaseClient,
  userId: string,
  agreementId: string,
  createdBy: string,
): Promise<boolean> {
  const wallets = await resolveUserWallets(client, userId);
  if (wallets.length === 0) return false;

  if (createdBy === userId || wallets.includes(createdBy)) return true;

  const { data: parts } = await client
    .from('agreement_participants')
    .select('wallet_address')
    .eq('agreement_id', agreementId)
    .in('wallet_address', wallets)
    .limit(1);

  return Boolean(parts?.length);
}
