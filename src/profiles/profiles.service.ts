import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import {
  GetOrCreateProfileDto,
  UpdateProfileDto,
  SetUserRoleDto,
} from "./dto/profiles.dto";

export type ProfileRole = "user" | "validator" | "dispute_resolver" | "admin";
export type AccountType = "personal" | "enterprise";

export interface Profile {
  id: string;
  wallet_address: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_type: AccountType;
  role: ProfileRole;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ProfilesService {
  constructor(private readonly supabase: SupabaseService) {}

  private async walletForUserId(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from("auth_users")
      .select("wallet_public_key")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data?.wallet_public_key) return null;
    return data.wallet_public_key as string;
  }

  private async assertActorWallet(userId: string, actorWallet: string) {
    const w = await this.walletForUserId(userId);
    if (!w || w !== actorWallet) {
      throw new ForbiddenException("Wallet does not match authenticated user");
    }
  }

  async getOrCreate(userId: string, dto: GetOrCreateProfileDto) {
    await this.assertActorWallet(userId, dto.wallet_address);

    // First, try to get existing profile
    const { data: existingProfile, error: fetchError } = await this.supabase
      .getClient()
      .from("profiles")
      .select("*")
      .eq("wallet_address", dto.wallet_address)
      .maybeSingle();

    if (existingProfile) {
      return { profile: existingProfile as Profile, error: null };
    }

    // Profile doesn't exist, create one
    if (fetchError && fetchError.code !== "PGRST116") {
      return { profile: null, error: fetchError.message };
    }

    const { data: newProfile, error: insertError } = await this.supabase
      .getClient()
      .from("profiles")
      .insert({
        wallet_address: dto.wallet_address,
        account_type: dto.account_type || "personal",
        role: "user",
      })
      .select()
      .single();

    if (insertError) {
      return { profile: null, error: insertError.message };
    }

    return { profile: newProfile as Profile, error: null };
  }

  async getByWallet(walletAddress: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from("profiles")
      .select("*")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      return { profile: null, error: error.message };
    }

    return { profile: (data as Profile) || null, error: null };
  }

  async update(userId: string, walletAddress: string, dto: UpdateProfileDto) {
    await this.assertActorWallet(userId, walletAddress);

    const { data, error } = await this.supabase
      .getClient()
      .from("profiles")
      .update({
        ...dto,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet_address", walletAddress)
      .select()
      .single();

    if (error) {
      return { profile: null, error: error.message };
    }

    return { profile: data as Profile, error: null };
  }

  async getByRole(role: ProfileRole) {
    const { data, error } = await this.supabase
      .getClient()
      .from("profiles")
      .select("*")
      .eq("role", role)
      .order("created_at", { ascending: false });

    if (error) {
      return { profiles: [], error: error.message };
    }

    return { profiles: (data as Profile[]) || [], error: null };
  }

  async setUserRole(userId: string, dto: SetUserRoleDto) {
    // Check if current user is admin
    const currentWallet = await this.walletForUserId(userId);
    if (!currentWallet) {
      throw new ForbiddenException("No wallet on profile");
    }

    const { data: currentProfile } = await this.supabase
      .getClient()
      .from("profiles")
      .select("role")
      .eq("wallet_address", currentWallet)
      .maybeSingle();

    if (!currentProfile || currentProfile.role !== "admin") {
      throw new ForbiddenException("Only admins can change user roles");
    }

    const { error } = await this.supabase
      .getClient()
      .from("profiles")
      .update({ role: dto.role, updated_at: new Date().toISOString() })
      .eq("wallet_address", dto.wallet_address);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  }

  async getDisputeResolvers() {
    return this.getByRole("dispute_resolver");
  }

  async getValidators() {
    return this.getByRole("validator");
  }
}
