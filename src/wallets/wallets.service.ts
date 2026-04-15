import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "../supabase/supabase.service";
import { LinkWalletDto, UpdateWalletDto, WalletType } from "./dto/wallets.dto";

export interface UserWallet {
  id: string;
  user_id: string;
  wallet_address: string;
  wallet_type: WalletType;
  label: string | null;
  is_primary: boolean;
  is_verified: boolean;
  verified_at: string | null;
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
  private readonly usdcAssetCode = "USDC";
  private readonly usdcIssuer: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {
    const network = this.config.get<string>("STELLAR_NETWORK") || "testnet";
    this.horizonUrl =
      network === "mainnet"
        ? "https://horizon.stellar.org"
        : "https://horizon-testnet.stellar.org";
    this.usdcIssuer =
      network === "mainnet"
        ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" // Circle USDC mainnet
        : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"; // Testnet USDC
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
      .from("user_wallets")
      .select("*")
      .eq("user_id", userId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

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
        const agreementsCount = await this.getAgreementsCount(
          wallet.wallet_address,
        );
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
  async getWalletBalance(
    walletAddress: string,
  ): Promise<{ xlm: string; usdc: string }> {
    try {
      const response = await fetch(
        `${this.horizonUrl}/accounts/${walletAddress}`,
      );

      if (!response.ok) {
        // Account might not exist or not be funded
        return { xlm: "0", usdc: "0" };
      }

      const account = await response.json();
      let xlmBalance = "0";
      let usdcBalance = "0";

      for (const balance of account.balances) {
        if (balance.asset_type === "native") {
          xlmBalance = balance.balance;
        } else if (
          balance.asset_code === this.usdcAssetCode &&
          balance.asset_issuer === this.usdcIssuer
        ) {
          usdcBalance = balance.balance;
        }
      }

      return { xlm: xlmBalance, usdc: usdcBalance };
    } catch (e) {
      console.error("Error fetching wallet balance:", e);
      return { xlm: "0", usdc: "0" };
    }
  }

  /**
   * Get count of agreements for a wallet
   */
  private async getAgreementsCount(walletAddress: string): Promise<number> {
    const { count, error } = await this.supabase
      .getClient()
      .from("agreement_participants")
      .select("*", { count: "exact", head: true })
      .eq("wallet_address", walletAddress);

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
      .from("user_wallets")
      .select("id")
      .eq("user_id", userId)
      .eq("wallet_address", dto.wallet_address)
      .maybeSingle();

    if (existing) {
      throw new ConflictException("Wallet is already linked to your account");
    }

    // Check if this is the first wallet (make it primary)
    const { count } = await this.supabase
      .getClient()
      .from("user_wallets")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    const isPrimary = count === 0;

    // For non-custodial wallets, require verification
    const isVerified = dto.wallet_type === "custodial";

    const { data, error } = await this.supabase
      .getClient()
      .from("user_wallets")
      .insert({
        user_id: userId,
        wallet_address: dto.wallet_address,
        wallet_type: dto.wallet_type,
        label: dto.label || null,
        is_primary: isPrimary,
        is_verified: isVerified,
        verified_at: isVerified ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictException("Wallet is already linked to an account");
      }
      return { wallet: null, error: error.message };
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
      .from("user_wallets")
      .select("*")
      .eq("id", walletId)
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new NotFoundException("Wallet not found");
    }

    // If setting as primary, unset other primaries first
    if (dto.is_primary) {
      await this.supabase
        .getClient()
        .from("user_wallets")
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .neq("id", walletId);
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (dto.label !== undefined) updates.label = dto.label;
    if (dto.is_primary !== undefined) updates.is_primary = dto.is_primary;

    const { data, error } = await this.supabase
      .getClient()
      .from("user_wallets")
      .update(updates)
      .eq("id", walletId)
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
      .from("user_wallets")
      .select("*")
      .eq("id", walletId)
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError || !wallet) {
      throw new NotFoundException("Wallet not found");
    }

    // Can't remove custodial wallet
    if ((wallet as UserWallet).wallet_type === "custodial") {
      throw new BadRequestException("Cannot remove custodial wallet");
    }

    const { error } = await this.supabase
      .getClient()
      .from("user_wallets")
      .delete()
      .eq("id", walletId)
      .eq("user_id", userId);

    if (error) {
      return { success: false, error: error.message };
    }

    // If removed wallet was primary, set another one as primary
    if ((wallet as UserWallet).is_primary) {
      const { data: remaining } = await this.supabase
        .getClient()
        .from("user_wallets")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      if (remaining) {
        await this.supabase
          .getClient()
          .from("user_wallets")
          .update({ is_primary: true })
          .eq("id", remaining.id);
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
          .from("agreement_participants")
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
          .eq("wallet_address", wallet.wallet_address);

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
          .map((p) => ({
            id: (p.agreement as Record<string, unknown>).id as string,
            title: (p.agreement as Record<string, unknown>).title as string,
            status: (p.agreement as Record<string, unknown>).status as string,
            amount: (p.agreement as Record<string, unknown>).amount as string,
            role: p.role,
            created_at: (p.agreement as Record<string, unknown>)
              .created_at as string,
          }));

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
  async walletBelongsToUser(
    userId: string,
    walletAddress: string,
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .getClient()
      .from("user_wallets")
      .select("id")
      .eq("user_id", userId)
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    return !error && !!data;
  }

  /**
   * Get the primary wallet for a user
   */
  async getPrimaryWallet(userId: string): Promise<UserWallet | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from("user_wallets")
      .select("*")
      .eq("user_id", userId)
      .eq("is_primary", true)
      .maybeSingle();

    if (error || !data) return null;
    return data as UserWallet;
  }
}
