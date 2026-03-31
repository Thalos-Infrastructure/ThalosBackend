import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { SearchUsersDto } from "./dto/search-users.dto";

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  async search(userId: string, dto: SearchUsersDto) {
    const sanitized = dto.q.replace(/[%_]/g, "");
    if (!sanitized) {
      return { users: [], page: dto.page ?? 1, limit: dto.limit ?? 10, error: null };
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 10;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        dto.q.trim(),
      );

    const excludeId = dto.exclude_profile_id ?? userId;

    let query = this.supabase
      .getClient()
      .from("profiles")
      .select("id, display_name, email, wallet_address", { count: "exact" });

    if (excludeId) {
      query = query.neq("id", excludeId);
    }

    if (isUUID) {
      query = query.eq("id", dto.q.trim()).limit(1);
    } else {
      query = query
        .or(
          `display_name.ilike.%${sanitized}%,email.ilike.%${sanitized}%,wallet_address.ilike.%${sanitized}%`,
        )
        .range(from, to);
    }

    const { data, error, count } = await query;

    if (error) {
      return { users: [], page, limit, total: 0, error: error.message };
    }

    const users = (data ?? []).map((u) => ({
      id: u.id,
      name: u.display_name || "Unknown",
      email: u.email || "",
      wallet_address: u.wallet_address || "",
    }));

    return {
      users,
      page,
      limit,
      total: count ?? users.length,
      error: null,
    };
  }
}
