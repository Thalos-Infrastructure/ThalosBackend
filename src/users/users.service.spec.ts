import { Test } from "@nestjs/testing";
import { SupabaseService } from "../supabase/supabase.service";
import { UsersService } from "./users.service";
import {
  createSupabaseClientMock,
  createSupabaseQueryMock,
} from "../../test/supabase.mock";

describe("UsersService", () => {
  it("searches profiles with a mocked Supabase client", async () => {
    const query = createSupabaseQueryMock({
      data: [
        {
          id: "profile-1",
          display_name: "Ada Lovelace",
          email: "ada@example.com",
          wallet_address: "GADA",
        },
      ],
      error: null,
      count: 1,
    });
    const client = createSupabaseClientMock(query);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: SupabaseService,
          useValue: { getClient: jest.fn(() => client) },
        },
      ],
    }).compile();

    const service = moduleRef.get(UsersService);

    await expect(
      service.search("current-user", { q: "Ada_%", page: 2, limit: 5 }),
    ).resolves.toEqual({
      users: [
        {
          id: "profile-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          wallet_address: "GADA",
        },
      ],
      page: 2,
      limit: 5,
      total: 1,
      error: null,
    });

    expect(client.from).toHaveBeenCalledWith("profiles");
    expect(query.select).toHaveBeenCalledWith(
      "id, display_name, email, wallet_address",
      { count: "exact" },
    );
    expect(query.neq).toHaveBeenCalledWith("id", "current-user");
    expect(query.or).toHaveBeenCalledWith(
      "display_name.ilike.%Ada%,email.ilike.%Ada%,wallet_address.ilike.%Ada%",
    );
    expect(query.range).toHaveBeenCalledWith(5, 9);
  });
});
