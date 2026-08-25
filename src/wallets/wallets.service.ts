import { createHmac, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { ApiClient } from '../common/api/api-client';
import {
  AuthProvider,
  LinkWalletDto,
  UpdateWalletDto,
  VerifyWalletDto,
  WalletType,
} from './dto/wallets.dto';
import {
  WALLET_OWNERSHIP_PREFIX,
  networkPassphrase,
  parseAndVerifyChallenge,
  verifyStellarSignature,
} from './helpers/stellar-verification.helper';

export interface UserWallet {
  id: string;
  user_id: string;
  wallet_address: string;
  wallet_type: WalletType;
  label: string | null;
  is_primary: boolean;
  is_verified: boolean;
  verified_at: string | null;
  /**
   * Identity provider that produced a provisioned wallet; null for external ones.
   * Optional, not merely nullable: the key is absent from rows read before 008/013
   * are applied and from the row the PGRST204 fallback below writes, so declaring
   * it required would have `data as UserWallet` assert a field that is not there.
   * The column itself is free text (008); this union is what LinkWalletDto admits,
   * and LinkWalletDto is its only writer.
   */
  auth_provider?: AuthProvider | null;
  /** Pollar user id when auth_provider is 'pollar'. Optional for the same reason. */
  pollar_user_id?: string | null;
  /** Soroban Smart Account address (C…); wallet_address holds the G-address. */
  c_address?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletWithBalance extends UserWallet {
  balance: {
    xlm: string;
    usdc: string;
  };
  agreements_count: number;
}

export interface WalletAgreementsSummary {
  wallet_address: string;
  wallet_type: WalletType;
  label: string | null;
  agreements: {
    id: string;
    title: string;
    status: string;
    amount: string;
    role: string;
    created_at: string;
  }[];
}

@Injectable()
export class WalletsService {
  private readonly horizonUrl: string;
  private readonly usdcAssetCode = 'USDC';
  private readonly usdcIssuer: string;
  private readonly stellarNetwork: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly apiClient: ApiClient,
  ) {
    this.stellarNetwork = this.config.get<string>('STELLAR_NETWORK') || 'testnet';
    this.horizonUrl =
      this.stellarNetwork === 'mainnet'
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org';
    this.usdcIssuer =
      this.stellarNetwork === 'mainnet'
        ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' // Circle USDC mainnet
        : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'; // Testnet USDC
  }

  /**
   * Get all wallets for a user
   */
  async getUserWallets(userId: string): Promise<{
    wallets: UserWallet[];
    error: string | null;
  }> {
    const { data, error } = await this.supabase
      .getClient()
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      return { wallets: [], error: error.message };
    }

    return { wallets: (data as UserWallet[]) || [], error: null };
  }

  /**
   * Get all wallets with balances for a user
   */
  async getUserWalletsWithBalances(userId: string): Promise<{
    wallets: WalletWithBalance[];
    error: string | null;
  }> {
    const { wallets, error } = await this.getUserWallets(userId);
    if (error) return { wallets: [], error };

    const walletsWithBalances = await Promise.all(
      wallets.map(async (wallet) => {
        const balance = await this.getWalletBalance(wallet.wallet_address);
        const agreementsCount = await this.getAgreementsCount(wallet.wallet_address);
        return {
          ...wallet,
          balance,
          agreements_count: agreementsCount,
        };
      }),
    );

    return { wallets: walletsWithBalances, error: null };
  }

  /**
   * Get balance for a specific wallet from Stellar Horizon
   */
  async getWalletBalance(walletAddress: string): Promise<{ xlm: string; usdc: string }> {
    const response = await this.apiClient.get<{
      balances: Array<{
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
        balance: string;
      }>;
    }>(`${this.horizonUrl}/accounts/${walletAddress}`);

    if (!response.success) {
      // Account might not exist or not be funded
      return { xlm: '0', usdc: '0' };
    }

    const account = response.data;
    if (!account) {
      return { xlm: '0', usdc: '0' };
    }

    let xlmBalance = '0';
    let usdcBalance = '0';

    for (const balance of account.balances) {
      if (balance.asset_type === 'native') {
        xlmBalance = balance.balance;
      } else if (
        balance.asset_code === this.usdcAssetCode &&
        balance.asset_issuer === this.usdcIssuer
      ) {
        usdcBalance = balance.balance;
      }
    }

    return { xlm: xlmBalance, usdc: usdcBalance };
  }

  /**
   * Get count of agreements for a wallet
   */
  private async getAgreementsCount(walletAddress: string): Promise<number> {
    const { count, error } = await this.supabase
      .getClient()
      .from('agreement_participants')
      .select('*', { count: 'exact', head: true })
      .eq('wallet_address', walletAddress);

    if (error) return 0;
    return count || 0;
  }

  /**
   * Link a new wallet to a user
   */
  async linkWallet(
    userId: string,
    dto: LinkWalletDto,
  ): Promise<{ wallet: UserWallet | null; error: string | null }> {
    // Check if wallet is already linked to this user
    const { data: existing } = await this.supabase
      .getClient()
      .from('user_wallets')
      .select('id')
      .eq('user_id', userId)
      .eq('wallet_address', dto.wallet_address)
      .maybeSingle();

    if (existing) {
      throw new ConflictException('Wallet is already linked to your account');
    }

    // Check if this is the first wallet (make it primary)
    const { count } = await this.supabase
      .getClient()
      .from('user_wallets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const isPrimary = count === 0;

    // For non-custodial wallets, require valid SEP-0043 signature.
    // Both branches below assign these before they are read.
    let isVerified: boolean;
    let verifiedAt: string | null;

    // Resolved per wallet_type below. A wallet connected by its owner in the
    // browser has no identity provider, so accepting one for it would record an
    // origin that never happened; the only external wallet that carries one is a
    // wallet Pollar itself authenticated.
    let authProvider: AuthProvider | null = null;
    let pollarUserId: string | null = null;

    if (dto.wallet_type === 'custodial') {
      // Custodial wallets are auto-verified
      isVerified = true;
      verifiedAt = new Date().toISOString();

      authProvider = dto.auth_provider ?? null;
      pollarUserId = dto.pollar_user_id ?? null;

      // pollar_user_id identifies a Pollar user; pairing it with another provider
      // would leave a row whose two identity columns disagree.
      if (pollarUserId && authProvider !== 'pollar') {
        throw new BadRequestException("pollar_user_id requires auth_provider 'pollar'");
      }
      if (authProvider === 'pollar' && !pollarUserId) {
        throw new BadRequestException("auth_provider 'pollar' requires pollar_user_id");
      }
    } else if (dto.wallet_type === 'accesly') {
      // Accesly (passkey smart account, #109) can't produce a classic SEP-0043
      // wallet signature here, but ownership of the G-address was already
      // proven server-side: the app JWT is minted only after the frontend
      // wallet-challenge verify (raw Ed25519 over the challenge, signed with
      // the same reconstructed owner key), which binds
      // auth_users.wallet_public_key to the address. Accept that proof.
      if (!dto.c_address) {
        throw new BadRequestException('c_address is required for accesly wallets');
      }

      // The passkey login provisioned this wallet, so wallet_type already names
      // the provider. Echoing 'accesly' back is fine, but any other provider —
      // or a Pollar user id — describes an origin this wallet does not have.
      // Refuse it rather than silently overwrite what the caller sent.
      if (dto.auth_provider && dto.auth_provider !== 'accesly') {
        throw new BadRequestException("auth_provider must be 'accesly' for an accesly wallet");
      }
      if (dto.pollar_user_id) {
        throw new BadRequestException('pollar_user_id is not valid for an accesly wallet');
      }
      const { data: authUser } = await this.supabase
        .getClient()
        .from('auth_users')
        .select('wallet_public_key')
        .eq('id', userId)
        .maybeSingle();
      if (authUser?.wallet_public_key !== dto.wallet_address) {
        throw new ForbiddenException('Accesly wallet does not match the authenticated user');
      }
      isVerified = true;
      verifiedAt = new Date().toISOString();

      // Guarded above: whatever the caller sent agrees with this or was refused.
      authProvider = 'accesly';
      pollarUserId = null;
    } else if (dto.auth_provider === 'pollar') {
      // A wallet the user brought, but authenticated through Pollar (#108).
      // It cannot produce a SEP-0043 signature here — the browser never held
      // the key, Pollar drove the wallet — but ownership was already proven:
      // Pollar runs SEP-10 against the wallet, and the app JWT is minted only
      // after that, writing the address onto auth_users.wallet_public_key.
      // Same shape of proof the accesly branch accepts, so the same treatment.
      if (!dto.pollar_user_id) {
        throw new BadRequestException("auth_provider 'pollar' requires pollar_user_id");
      }

      const { data: authUser, error: authUserError } = await this.supabase
        .getClient()
        .from('auth_users')
        .select('wallet_public_key')
        .eq('id', userId)
        .maybeSingle();
      // Without this the row simply comes back null and the check below reports a
      // database failure as 'your wallet does not match' — a 403 for something the
      // caller did not do, and nothing was ever read to compare against.
      if (authUserError) {
        throw new InternalServerErrorException('Could not read the authenticated wallet');
      }
      if (authUser?.wallet_public_key !== dto.wallet_address) {
        throw new ForbiddenException('Pollar wallet does not match the authenticated user');
      }

      isVerified = true;
      verifiedAt = new Date().toISOString();
      authProvider = 'pollar';
      pollarUserId = dto.pollar_user_id;
    } else {
      if (dto.auth_provider || dto.pollar_user_id) {
        throw new BadRequestException(
          'auth_provider and pollar_user_id are only valid for wallets a login provisioned or authenticated',
        );
      }

      // Non-custodial: require signed_message + signature
      if (!dto.signed_message || !dto.signature) {
        throw new BadRequestException(
          'signed_message and signature are required for non-custodial wallets',
        );
      }

      const jwtSecret = this.config.get<string>('JWT_SECRET');
      if (!jwtSecret) {
        throw new InternalServerErrorException('Server misconfiguration');
      }

      // 1. Parse & verify the HMAC-proofed challenge
      const payload = parseAndVerifyChallenge(dto.signed_message, jwtSecret);

      // 2. Check challenge belongs to this user and wallet
      if (payload.sub !== userId) {
        throw new ForbiddenException('Challenge was not issued for this user');
      }
      if (payload.addr !== dto.wallet_address) {
        throw new ForbiddenException('Challenge was not issued for this wallet address');
      }

      // 3. Verify Stellar Ed25519 signature
      const passphrase = networkPassphrase(this.stellarNetwork);
      verifyStellarSignature(dto.signed_message, dto.signature, dto.wallet_address, passphrase);

      isVerified = true;
      verifiedAt = new Date().toISOString();
    }

    const baseRow = {
      user_id: userId,
      wallet_address: dto.wallet_address,
      wallet_type: dto.wallet_type,
      label: dto.label || null,
      is_primary: isPrimary,
      is_verified: isVerified,
      verified_at: verifiedAt,
    };

    // Accesly (#109) / Pollar (FE #108) identity: login method, Pollar user id
    // and Smart Account C-address. wallet_address keeps the derived G-address,
    // which is what Trustless Work role matching (by-signer / by-role) keys on.
    // authProvider and pollarUserId were resolved per wallet_type above.
    const identityRow = {
      ...baseRow,
      ...(authProvider ? { auth_provider: authProvider } : {}),
      ...(pollarUserId ? { pollar_user_id: pollarUserId } : {}),
      ...(dto.c_address ? { c_address: dto.c_address } : {}),
    };

    let { data, error } = await this.supabase
      .getClient()
      .from('user_wallets')
      .insert(identityRow)
      .select()
      .single();

    // Fall back to the base row while migrations 008/013 haven't been applied.
    if (error && error.code === 'PGRST204') {
      console.warn(
        `[wallets] user_wallets is missing the identity columns (migrations 008/013 pending) — ` +
          `linking ${dto.wallet_address} WITHOUT auth_provider/pollar_user_id/c_address`,
      );
      ({ data, error } = await this.supabase
        .getClient()
        .from('user_wallets')
        .insert(baseRow)
        .select()
        .single());
    }

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Wallet is already linked to an account');
      }
      return { wallet: null, error: error.message };
    }

    // Persist the login method on the auth user so the frontend's
    // /api/auth/me can echo it and route signing to the right provider
    // after a reload. Non-fatal (and a no-op until migration 008 runs).
    if (authProvider) {
      const { error: providerError } = await this.supabase
        .getClient()
        .from('auth_users')
        .update({ wallet_provider: authProvider })
        .eq('id', userId);
      if (providerError) {
        console.warn(
          `[wallets] could not persist auth_users.wallet_provider=${authProvider}: ${providerError.message}`,
        );
      }
    }

    return { wallet: data as UserWallet, error: null };
  }

  /**
   * Update a wallet (label, primary status)
   */
  async updateWallet(
    userId: string,
    walletId: string,
    dto: UpdateWalletDto,
  ): Promise<{ wallet: UserWallet | null; error: string | null }> {
    // First verify ownership
    const { data: existing, error: fetchError } = await this.supabase
      .getClient()
      .from('user_wallets')
      .select('*')
      .eq('id', walletId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new NotFoundException('Wallet not found');
    }

    // If setting as primary, unset other primaries first
    if (dto.is_primary) {
      await this.supabase
        .getClient()
        .from('user_wallets')
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .neq('id', walletId);
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.label !== undefined) updates.label = dto.label;
    if (dto.is_primary !== undefined) updates.is_primary = dto.is_primary;

    const { data, error } = await this.supabase
      .getClient()
      .from('user_wallets')
      .update(updates)
      .eq('id', walletId)
      .select()
      .single();

    if (error) {
      return { wallet: null, error: error.message };
    }

    return { wallet: data as UserWallet, error: null };
  }

  /**
   * Remove a wallet from user account
   */
  async unlinkWallet(
    userId: string,
    walletId: string,
  ): Promise<{ success: boolean; error: string | null }> {
    // Can't remove primary wallet if it's the only one
    const { data: wallet, error: fetchError } = await this.supabase
      .getClient()
      .from('user_wallets')
      .select('*')
      .eq('id', walletId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError || !wallet) {
      throw new NotFoundException('Wallet not found');
    }

    // Can't remove custodial wallet
    if ((wallet as UserWallet).wallet_type === 'custodial') {
      throw new BadRequestException('Cannot remove custodial wallet');
    }

    const { error } = await this.supabase
      .getClient()
      .from('user_wallets')
      .delete()
      .eq('id', walletId)
      .eq('user_id', userId);

    if (error) {
      return { success: false, error: error.message };
    }

    // If removed wallet was primary, set another one as primary
    if ((wallet as UserWallet).is_primary) {
      const { data: remaining } = await this.supabase
        .getClient()
        .from('user_wallets')
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (remaining) {
        await this.supabase
          .getClient()
          .from('user_wallets')
          .update({ is_primary: true })
          .eq('id', remaining.id);
      }
    }

    return { success: true, error: null };
  }

  /**
   * Get all agreements grouped by wallet for a user
   */
  async getAgreementsByWallet(userId: string): Promise<{
    wallets: WalletAgreementsSummary[];
    error: string | null;
  }> {
    const { wallets, error: walletsError } = await this.getUserWallets(userId);
    if (walletsError) return { wallets: [], error: walletsError };

    const walletsWithAgreements: WalletAgreementsSummary[] = await Promise.all(
      wallets.map(async (wallet) => {
        // Get all agreement participations for this wallet
        const { data: participations, error: partError } = await this.supabase
          .getClient()
          .from('agreement_participants')
          .select(
            `
            role,
            agreement:agreements (
              id,
              title,
              status,
              amount,
              created_at
            )
          `,
          )
          .eq('wallet_address', wallet.wallet_address);

        if (partError || !participations) {
          return {
            wallet_address: wallet.wallet_address,
            wallet_type: wallet.wallet_type,
            label: wallet.label,
            agreements: [],
          };
        }

        const agreements = participations
          .filter((p) => p.agreement)
          .map((p) => {
            const agreement = p.agreement as unknown as {
              id: string;
              title: string;
              status: string;
              amount: string;
              created_at: string;
            };
            return {
              id: agreement.id,
              title: agreement.title,
              status: agreement.status,
              amount: agreement.amount,
              role: p.role,
              created_at: agreement.created_at,
            };
          });

        return {
          wallet_address: wallet.wallet_address,
          wallet_type: wallet.wallet_type,
          label: wallet.label,
          agreements,
        };
      }),
    );

    return { wallets: walletsWithAgreements, error: null };
  }

  /**
   * Check if a wallet belongs to the user
   */
  async walletBelongsToUser(userId: string, walletAddress: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .getClient()
      .from('user_wallets')
      .select('id')
      .eq('user_id', userId)
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    return !error && !!data;
  }

  /**
   * Get the primary wallet for a user
   */
  async getPrimaryWallet(userId: string): Promise<UserWallet | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('is_primary', true)
      .maybeSingle();

    if (error || !data) return null;
    return data as UserWallet;
  }

  /**
   * Generate a stateless wallet ownership verification challenge (SEP-0043 style).
   * HMAC-SHA256 signed with JWT_SECRET.
   */
  generateVerificationChallenge(
    userId: string,
    address: string,
  ): { message: string; expires_at: string } {
    const TTL_MS = 5 * 60 * 1000;
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TTL_MS);
    const nonce = randomBytes(16).toString('hex');

    const payload = {
      v: 1,
      sub: userId,
      addr: address,
      nonce,
      exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new InternalServerErrorException('Server misconfiguration');
    }

    const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');

    // SEP-53 canonical envelope: "Stellar Signed Message:\n" + body.
    // Wallets sign SHA-256(envelopeBytes). The HMAC Proof line is appended
    // after signing so it never influences the signature bytes.
    const message =
      `Stellar Signed Message:\n` +
      `${WALLET_OWNERSHIP_PREFIX}\n` +
      `\n` +
      `I authorize linking this wallet to my Thalos account.\n` +
      `Account: ${userId}\n` +
      `Wallet: ${address}\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt.toISOString()}\n` +
      `Expires At: ${expiresAt.toISOString()}\n` +
      `\n` +
      `Proof: ${payloadB64}.${sig}`;

    return { message, expires_at: expiresAt.toISOString() };
  }

  /**
   * POST /wallets/:id/verify
   * Verify a previously linked but unverified wallet using SEP-0043 signature.
   */
  async verifyWallet(
    userId: string,
    walletId: string,
    dto: VerifyWalletDto,
  ): Promise<{ wallet: UserWallet | null; error: string | null }> {
    // Fetch the wallet and confirm ownership
    const { data: wallet, error: fetchError } = await this.supabase
      .getClient()
      .from('user_wallets')
      .select('*')
      .eq('id', walletId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError || !wallet) {
      throw new NotFoundException('Wallet not found');
    }

    const existingWallet = wallet as UserWallet;

    if (existingWallet.is_verified) {
      return { wallet: existingWallet, error: null };
    }

    // Wallet address must match
    if (existingWallet.wallet_address !== dto.wallet_address) {
      throw new BadRequestException('Wallet address does not match');
    }

    const jwtSecret = this.config.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new InternalServerErrorException('Server misconfiguration');
    }

    // 1. Parse & verify the HMAC-proofed challenge
    const payload = parseAndVerifyChallenge(dto.signed_message, jwtSecret);

    // 2. Check challenge belongs to this user and wallet
    if (payload.sub !== userId) {
      throw new ForbiddenException('Challenge was not issued for this user');
    }
    if (payload.addr !== dto.wallet_address) {
      throw new ForbiddenException('Challenge was not issued for this wallet address');
    }

    // 3. Verify Stellar Ed25519 signature
    const passphrase = networkPassphrase(this.stellarNetwork);
    verifyStellarSignature(dto.signed_message, dto.signature, dto.wallet_address, passphrase);

    // 4. Mark as verified
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .getClient()
      .from('user_wallets')
      .update({
        is_verified: true,
        verified_at: now,
        updated_at: now,
      })
      .eq('id', walletId)
      .select()
      .single();

    if (error) {
      return { wallet: null, error: error.message };
    }

    return { wallet: data as UserWallet, error: null };
  }
}
