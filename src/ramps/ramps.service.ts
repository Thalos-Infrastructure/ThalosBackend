import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { resolveUserWallets, userCanAccessAgreement } from '../common/wallets/resolve-user-wallets';
import { LendaraClient, issuerOf, type LendaraTransaction } from './lendara.client';
import { getTrustline } from '../internal-trustless/escrow-write.helper';

/**
 * Fiat → USDC on-ramp, scoped to an agreement.
 *
 * Two rules shape this service, both from the issue:
 *
 * 1. **The browser never picks the destination.** The wallet the USDC is sent
 *    to is derived here, from the authenticated user and the agreement. A
 *    client that asks to on-ramp into someone else's address is refused, so a
 *    tampered request cannot redirect a payment.
 * 2. **A session is not a delivery.** Opening the widget proves nothing; the
 *    transaction has to be read back and checked before anything is reported
 *    as successful.
 */
@Injectable()
export class RampsService {
  private readonly logger = new Logger(RampsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly lendara: LendaraClient,
  ) {}

  /**
   * The wallet an on-ramp for this agreement must pay into.
   *
   * The funding side of an agreement is the approver, so that is the
   * destination — but only if it is a wallet the caller actually owns.
   * Without that second check, any participant could start a session paying
   * into the approver's wallet, which is a worse failure than it sounds: the
   * payer would be funding someone else's address.
   */
  private async destinationWalletFor(userId: string, agreementId: string): Promise<string> {
    const client = this.supabase.getClient();

    const { data: agreement, error } = await client
      .from('agreements')
      .select('id, created_by')
      .eq('id', agreementId)
      .maybeSingle();
    if (error || !agreement) throw new NotFoundException('Agreement not found');

    const createdBy = (agreement as { created_by: string }).created_by;
    if (!(await userCanAccessAgreement(client, userId, agreementId, createdBy))) {
      throw new ForbiddenException('Not a participant of this agreement');
    }

    const wallets = await resolveUserWallets(client, userId);
    if (wallets.length === 0) {
      throw new BadRequestException('This account has no wallet to receive the funds');
    }

    const { data: participants } = await client
      .from('agreement_participants')
      .select('wallet_address, role')
      .eq('agreement_id', agreementId);

    const payer = (participants ?? []).find((p) => (p as { role?: string }).role === 'payer') as
      { wallet_address?: string } | undefined;

    // Prefer the agreement's payer when the caller owns it; otherwise the
    // caller's own primary wallet. Either way it is a wallet they own.
    const candidate = payer?.wallet_address;
    if (candidate && wallets.includes(candidate)) return candidate;

    if (candidate && !wallets.includes(candidate)) {
      throw new ForbiddenException('Only the wallet funding this agreement can buy USDC for it');
    }

    return wallets[0];
  }

  async createSession(
    userId: string,
    params: { agreementId: string; fiatCurrency: string; amount: string },
  ): Promise<{ id: string; url: string; expires_at?: string; account: string }> {
    const account = await this.destinationWalletFor(userId, params.agreementId);

    const session = await this.lendara.createSession({
      account,
      fiat_currency: params.fiatCurrency,
      amount: params.amount,
    });

    if (!session?.url || !session?.id) {
      throw new BadRequestException('Lendara did not return a usable session');
    }

    this.logger.log(
      `Lendara session ${session.id} for agreement ${params.agreementId} → ${account}`,
    );
    return { ...session, account };
  }

  /**
   * Confirm the USDC actually arrived, in the right wallet, as the right asset.
   *
   * The destination is recomputed here rather than taken from the request, so
   * verification cannot be pointed at an address the caller chose. Anything
   * this cannot read is treated as unverified: a transaction whose shape we do
   * not recognise must not be reported as a success.
   */
  async verify(
    userId: string,
    params: { agreementId: string; sessionId: string },
  ): Promise<{
    verified: boolean;
    reason?: string;
    stellarTransactionId?: string;
    /** True when the asset delivered is the one the escrows actually use. */
    usableForEscrow?: boolean;
  }> {
    const expectedAccount = await this.destinationWalletFor(userId, params.agreementId);
    const tx = await this.lendara.getTransaction(params.sessionId);

    const status = (tx.status ?? '').toLowerCase();
    if (!['completed', 'complete', 'success', 'succeeded'].includes(status)) {
      return { verified: false, reason: `The deposit is ${tx.status ?? 'not finished'}` };
    }

    // SEP-24 calls it `to`; the others are fallbacks for a differing REST shape.
    const destination = tx.to ?? tx.destination ?? tx.account;
    if (!destination) {
      return { verified: false, reason: 'Lendara did not report a destination account' };
    }
    if (destination.toUpperCase() !== expectedAccount.toUpperCase()) {
      // Not a user error: either the session was created for another wallet or
      // the id belongs to someone else's transaction.
      this.logger.warn(
        `Lendara session ${params.sessionId} paid ${destination}, expected ${expectedAccount}`,
      );
      return { verified: false, reason: 'The deposit went to a different wallet' };
    }

    if (!tx.stellar_transaction_id) {
      return { verified: false, reason: 'Lendara did not report a Stellar transaction' };
    }

    return {
      verified: true,
      stellarTransactionId: tx.stellar_transaction_id,
      usableForEscrow: this.matchesEscrowAsset(tx),
    };
  }

  /**
   * Whether the delivered asset is the one Trustless Work escrows hold.
   *
   * They are not the same in sandbox: Lendara issues its own test USDC while
   * the escrows use another issuer, and on Stellar two assets with the same
   * code but different issuers are simply different tokens. Reporting this
   * separately from `verified` keeps "the money arrived" distinct from "the
   * money can fund the escrow", which is the confusion the whole flow has to
   * avoid.
   */
  private matchesEscrowAsset(tx: LendaraTransaction): boolean {
    const expected = getTrustline();
    // SEP-24 reports the delivered asset as `stellar:USDC:GABC…`.
    const issuer = issuerOf(tx.amount_out_asset) ?? tx.asset_issuer;
    if (!issuer) return false;
    return issuer.toUpperCase() === expected.address.toUpperCase();
  }
}
