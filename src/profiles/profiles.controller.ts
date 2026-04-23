import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUserCtx } from "../auth/current-user.decorator";
import { ProfilesService } from "./profiles.service";
import {
  GetOrCreateProfileDto,
  UpdateProfileDto,
  SetUserRoleDto,
} from "./dto/profiles.dto";

@Controller("profiles")
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  getOrCreate(
    @CurrentUser() user: AuthUserCtx,
    @Body() dto: GetOrCreateProfileDto
  ) {
    return this.profiles.getOrCreate(user.userId, dto);
  }

  @Get("by-wallet/:wallet")
  getByWallet(@Param("wallet") wallet: string) {
    return this.profiles.getByWallet(wallet);
  }

  @Patch("by-wallet/:wallet")
  @UseGuards(JwtAuthGuard)
  update(
    @CurrentUser() user: AuthUserCtx,
    @Param("wallet") wallet: string,
    @Body() dto: UpdateProfileDto
  ) {
    return this.profiles.update(user.userId, wallet, dto);
  }

  @Get("dispute-resolvers")
  getDisputeResolvers() {
    return this.profiles.getDisputeResolvers();
  }

  @Get("validators")
  getValidators() {
    return this.profiles.getValidators();
  }

  @Patch("set-role")
  @UseGuards(JwtAuthGuard)
  setRole(@CurrentUser() user: AuthUserCtx, @Body() dto: SetUserRoleDto) {
    return this.profiles.setUserRole(user.userId, dto);
  }
}
