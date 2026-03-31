import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUserCtx } from "../auth/current-user.decorator";
import { UsersService } from "./users.service";
import { SearchUsersDto } from "./dto/search-users.dto";

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("search")
  search(@CurrentUser() user: AuthUserCtx, @Query() dto: SearchUsersDto) {
    return this.users.search(user.userId, dto);
  }
}
