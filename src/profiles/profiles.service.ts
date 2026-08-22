import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  GetOrCreateProfileDto,
  UpdateProfileDto,
  SetUserRoleDto,
  DiscoverProfilesDto,
} from './dto/profiles.dto';

export type ProfileRole = 'user' | 'validator' | 'dispute_resolver' | 'admin';
export type AccountType = 'personal' | 'enterprise';
export type Availability = 'available' | 'open' | 'unavailable';

export interface Profile {
  id: string;
  wallet_address: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_type: AccountType;
  role: ProfileRole;
  // NOTE: `handle` will be added here when Connect (#159) merges.
  // NOTE: `github_verified` will be derived from `github_verified_at` when C6 (#157) merges.
  show_earnings: boolean;
  created_at: string;
  updated_at: string;
  // Builder fields (Thalos Connect)
  headline: string | null;
  bio: string | null;
  skills: string[] | null;
  tech_stack: string[] | null;
  hourly_rate: number | null;
  availability: Availability | null;
  portfolio_links: unknown;
  social_links: Record<string, unknown> | null;
  handle: string | null;
  // Project fields (Thalos Connect)
  org_name: string | null;
  org_description: string | null;
  org_website: string | null;
  looking_for: string[] | null;
  org_links: Record<string, unknown> | null;
}

/** Public-safe columns for unauthenticated endpoints (never email/KYB/private). */
export const PUBLIC_PROFILE_COLUMNS = [
  'id',
  'wallet_address',
  'display_name',
  'avatar_url',
  'account_type',
  'headline',
  'bio',
  'skills',
  'tech_stack',
  'hourly_rate',
  'availability',
  'portfolio_links',
  'social_links',
  'handle',
  'org_name',
  'org_description',
  'org_website',
  'looking_for',
  'org_links',
  'created_at',
].join(', ');

export type PublicProfile = Omit<Profile, 'email' | 'role' | 'updated_at'>;

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProfilesService {
  constructor(private readonly supabase: SupabaseService) {}

  private async walletForUserId(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('auth_users')
      .select('wallet_public_key')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data?.wallet_public_key) return null;
    return data.wallet_public_key as string;
  }

  private async assertActorWallet(userId: string, actorWallet: string) {
    const w = await this.walletForUserId(userId);
    if (!w || w !== actorWallet) {
      throw new ForbiddenException('Wallet does not match authenticated user');
    }
  }

  async getOrCreate(userId: string, dto: GetOrCreateProfileDto) {
    await this.assertActorWallet(userId, dto.wallet_address);

    // First, try to get existing profile
    const { data: existingProfile, error: fetchError } = await this.supabase
      .getClient()
      .from('profiles')
      .select('*')
      .eq('wallet_address', dto.wallet_address)
      .maybeSingle();

    if (existingProfile) {
      return { profile: existingProfile as Profile, error: null };
    }

    // Profile doesn't exist, create one
    if (fetchError && fetchError.code !== 'PGRST116') {
      return { profile: null, error: fetchError.message };
    }

    const { data: newProfile, error: insertError } = await this.supabase
      .getClient()
      .from('profiles')
      .insert({
        wallet_address: dto.wallet_address,
        account_type: dto.account_type || 'personal',
        role: 'user',
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
      .from('profiles')
      .select('*')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      return { profile: null, error: error.message };
    }

    return { profile: (data as Profile) || null, error: null };
  }

  async update(userId: string, walletAddress: string, dto: UpdateProfileDto) {
    await this.assertActorWallet(userId, walletAddress);
    return this.applyUpdate({ wallet_address: walletAddress }, dto);
  }

  /** Update the authenticated user's own profile (PATCH /profiles). */
  async updateForUser(userId: string, dto: UpdateProfileDto) {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      throw new NotFoundException('No wallet found for authenticated user');
    }
    return this.applyUpdate({ wallet_address: wallet }, dto);
  }

  private async applyUpdate(match: Record<string, string>, dto: UpdateProfileDto) {
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .update({
        ...dto,
        updated_at: new Date().toISOString(),
      })
      .match(match)
      .select()
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('handle is already taken');
      }
      return { profile: null, error: error.message };
    }

    return { profile: data as Profile, error: null };
  }

  /** GET /profiles/:id — full profile by id (authenticated app view). */
  async getById(id: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      return { profile: null, error: error.message };
    }
    if (!data) {
      throw new NotFoundException('Profile not found');
    }
    return { profile: data as Profile, error: null };
  }

  /** GET /profiles/me — the authenticated user's own profile. */
  async getMe(userId: string) {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) {
      throw new NotFoundException('No wallet found for authenticated user');
    }
    return this.getByWallet(wallet);
  }

  /** GET /profiles/handle/:handle — public, public-safe fields only. */
  async getByHandle(handle: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select(PUBLIC_PROFILE_COLUMNS)
      .eq('handle', handle)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      return { profile: null, error: error.message };
    }
    if (!data) {
      throw new NotFoundException('Profile not found');
    }
    return { profile: data as unknown as PublicProfile, error: null };
  }

  /** GET /profiles — public discovery directory (profiles with a handle). */
  async discover(dto: DiscoverProfilesDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 12;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = this.supabase
      .getClient()
      .from('profiles')
      .select(PUBLIC_PROFILE_COLUMNS, { count: 'exact' })
      .not('handle', 'is', null);

    const skills = this.parseList(dto.skills);
    if (skills.length) {
      query = query.overlaps('skills', skills);
    }

    const techStack = this.parseList(dto.tech_stack);
    if (techStack.length) {
      query = query.overlaps('tech_stack', techStack);
    }

    if (dto.availability) {
      query = query.eq('availability', dto.availability);
    }

    if (dto.q) {
      const sanitized = dto.q.replace(/[%_,]/g, '').trim();
      if (sanitized) {
        query = query.or(`headline.ilike.%${sanitized}%,bio.ilike.%${sanitized}%`);
      }
    }

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, error, count } = await query;

    if (error) {
      return { profiles: [], page, limit, total: 0, error: error.message };
    }

    return {
      profiles: (data as unknown as PublicProfile[]) ?? [],
      page,
      limit,
      total: count ?? 0,
      error: null,
    };
  }

  private parseList(value?: string): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  async getByRole(role: ProfileRole) {
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('*')
      .eq('role', role)
      .order('created_at', { ascending: false });

    if (error) {
      return { profiles: [], error: error.message };
    }

    return { profiles: (data as Profile[]) || [], error: null };
  }

  async setUserRole(userId: string, dto: SetUserRoleDto) {
    // Check if current user is admin
    const currentWallet = await this.walletForUserId(userId);
    if (!currentWallet) {
      throw new ForbiddenException('No wallet on profile');
    }

    const { data: currentProfile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('role')
      .eq('wallet_address', currentWallet)
      .maybeSingle();

    if (!currentProfile || currentProfile.role !== 'admin') {
      throw new ForbiddenException('Only admins can change user roles');
    }

    const { error } = await this.supabase
      .getClient()
      .from('profiles')
      .update({ role: dto.role, updated_at: new Date().toISOString() })
      .eq('wallet_address', dto.wallet_address);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  }

  async getDisputeResolvers() {
    return this.getByRole('dispute_resolver');
  }

  async getValidators() {
    return this.getByRole('validator');
  }
}
