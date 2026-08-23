import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { ProfilesService } from './profiles.service';
import {
  GetOrCreateProfileDto,
  UpdateProfileDto,
  SetUserRoleDto,
  DiscoverProfilesDto,
} from './dto/profiles.dto';

@ApiTags('profiles')
@ApiBearerAuth('bearer')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  // ---- Public discovery directory (Connect Builders tab) ----
  @Get()
  discover(@Query() dto: DiscoverProfilesDto) {
    return this.profiles.discover(dto);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  getOrCreate(@CurrentUser() user: AuthUserCtx, @Body() dto: GetOrCreateProfileDto) {
    return this.profiles.getOrCreate(user.userId, dto);
  }

  // ---- Authenticated: update own profile ----
  @Patch()
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: AuthUserCtx, @Body() dto: UpdateProfileDto) {
    return this.profiles.updateForUser(user.userId, dto);
  }

  // NOTE: static GET routes must be declared before the dynamic ":id" route.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthUserCtx) {
    return this.profiles.getMe(user.userId);
  }

  // ---- Public: profile by handle (public-safe fields only) ----
  @Get('handle/:handle')
  getByHandle(@Param('handle') handle: string) {
    return this.profiles.getByHandle(handle);
  }

  @Get('dispute-resolvers')
  getDisputeResolvers() {
    return this.profiles.getDisputeResolvers();
  }

  @Get('validators')
  getValidators() {
    return this.profiles.getValidators();
  }

  @Get('by-wallet/:wallet')
  getByWallet(@Param('wallet') wallet: string) {
    return this.profiles.getByWallet(wallet);
  }

  @Patch('by-wallet/:wallet')
  @UseGuards(JwtAuthGuard)
  update(
    @CurrentUser() user: AuthUserCtx,
    @Param('wallet') wallet: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profiles.update(user.userId, wallet, dto);
  }

  @Patch('set-role')
  @UseGuards(JwtAuthGuard)
  setRole(@CurrentUser() user: AuthUserCtx, @Body() dto: SetUserRoleDto) {
    return this.profiles.setUserRole(user.userId, dto);
  }

  // ---- Authenticated: full profile by id (declared last) ----
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getById(@Param('id') id: string) {
    return this.profiles.getById(id);
  }
}
