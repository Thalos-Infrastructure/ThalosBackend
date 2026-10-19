import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { getTrustline, isMainnet } from './escrow-write.helper';

/**
 * Funds cannot reach an address that does not hold the asset's trustline.
 *
 * Trustless Work is explicit about it: "every address that will receive tokens
 * (receiver(s), platformAddress for fees, dispute-distribution addresses) needs
 * it before funds reach them."
 *
 * Checked before the unsigned XDR is built, not after. The alternative is the
 * dispute resolver signing a transaction that bounces on submit, which spends a
 * signature on nothing and leaves the funds locked with no explanation anyone
 * can act on.
 *
 * Fails closed, like `assertEscrowFunded`: if Horizon cannot be reached the
 * resolution is refused with 503 and can be retried, rather than let through on
 * the assumption that it is probably fine.
 */

const HORIZON_TIMEOUT_MS = 10_000;

/**
 * The issuer to check against.
 *
 * Callers that have read the escrow pass its own `trustline.address`, which is
 * the asset the funds are actually in. Without it, fall back to the issuer the
 * escrow-write helper puts on every escrow this app creates — resolved there
 * and not again here, because it differs by network and reading
 * `TRUSTLINE_USDC_ADDRESS` separately would check the testnet issuer against a
 * mainnet escrow and report every recipient as missing a trustline.
 */
export interface EscrowAsset {
  /** Issuer address. Shaped like the escrow's own `trustline` object. */
  address?: string;
  symbol?: string;
}

function usdcIssuer(asset?: EscrowAsset): string {
  return asset?.address?.trim() || getTrustline().address;
}

function assetName(asset?: EscrowAsset): string {
  return asset?.symbol?.trim() || getTrustline().symbol;
}

/** Same network the escrows are created on — `isMainnet` also accepts `public`. */
function horizonUrl(): string {
  return isMainnet() ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
}

interface HorizonBalance {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

type TrustlineState = 'held' | 'missing' | 'no-account';

async function readTrustline(address: string, issuer: string): Promise<TrustlineState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HORIZON_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${horizonUrl()}/accounts/${address}`, {
      signal: controller.signal,
    });
  } catch {
    throw new ServiceUnavailableException(
      'Could not reach Stellar Horizon to check the recipients. Try again in a moment.',
    );
  } finally {
    clearTimeout(timer);
  }

  // An address nobody has funded has no account on the ledger, so it holds no
  // trustline either — a distinct case worth naming, because the fix differs.
  if (response.status === 404) return 'no-account';

  if (!response.ok) {
    throw new ServiceUnavailableException(
      `Stellar Horizon answered ${response.status} while checking ${address}. Try again in a moment.`,
    );
  }

  const account = (await response.json()) as { balances?: HorizonBalance[] };
  const balances = account.balances ?? [];

  // The trustline exists when the balance line exists, whatever its amount: a
  // zero balance still means the address can receive the asset.
  // Matched on the issuer alone: the asset code is 'USDC' for every issuer this
  // app uses, and pinning it here would reject an escrow denominated in
  // anything else rather than check it.
  const holds = balances.some((balance) => balance.asset_issuer === issuer);
  return holds ? 'held' : 'missing';
}

export interface TrustlineProblem {
  address: string;
  reason: TrustlineState;
}

/**
 * Refuse unless every recipient can actually receive USDC.
 *
 * Only addresses that appear in the distributions are checked. A party given
 * 0% is dropped before this point, so a 100/0 resolution can go through even
 * when the other side has never set up a trustline.
 */
export async function assertRecipientsCanReceive(
  addresses: string[],
  asset?: EscrowAsset,
): Promise<void> {
  const unique = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))];
  if (unique.length === 0) return;

  const issuer = usdcIssuer(asset);
  const states = await Promise.all(
    unique.map(async (address) => ({ address, reason: await readTrustline(address, issuer) })),
  );

  const problems = states.filter((s): s is TrustlineProblem => s.reason !== 'held');
  if (problems.length === 0) return;

  // Structured, not just a sentence: the UI has to name the party that cannot
  // receive, because the resolver cannot fix it — only the holder of that
  // address can add the trustline.
  const symbol = assetName(asset);
  throw new BadRequestException({
    message:
      problems.length === 1
        ? `One recipient cannot receive ${symbol} yet, so this resolution would fail on submit.`
        : `Some recipients cannot receive ${symbol} yet, so this resolution would fail on submit.`,
    code: 'TRUSTLINE_MISSING',
    problems,
  });
}
