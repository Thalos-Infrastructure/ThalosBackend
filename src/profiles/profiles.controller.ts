import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { ProfilesService } from './profiles.service';
import { ReputationService, ReputationPayload } from './reputation.service';
import { GetOrCreateProfileDto, UpdateProfileDto, SetUserRoleDto } from './dto/profiles.dto';

@ApiTags('profiles')
@ApiBearerAuth('bearer')
@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly reputation: ReputationService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  getOrCreate(@CurrentUser() user: AuthUserCtx, @Body() dto: GetOrCreateProfileDto) {
    return this.profiles.getOrCreate(user.userId, dto);
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

  @Get('handle/:handle/reputation')
  @ApiOperation({
    summary: 'Public reputation summary for a builder by handle',
    description:
      'Returns aggregated reputation data (completed agreements, released milestones, ' +
      'PR-backed milestones, GitHub verification status). No auth required. ' +
      'Earnings (total_released_usdc) are only visible when the builder has opted in.',
  })
  getPublicReputation(@Param('handle') handle: string): Promise<ReputationPayload> {
    return this.reputation.getPublicReputation(handle);
  }

  @Get('me/reputation')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Authenticated builder own reputation summary',
    description:
      'Returns the authenticated builder full reputation data including earnings. ' +
      'Mirrors the public /handle/:handle/reputation endpoint but always includes total_released_usdc.',
  })
  getMyReputation(@CurrentUser() user: AuthUserCtx): Promise<ReputationPayload> {
    return this.reputation.getMyReputation(user.userId);
  }

  @Get('dispute-resolvers')
  getDisputeResolvers() {
    return this.profiles.getDisputeResolvers();
  }

  @Get('validators')
  getValidators() {
    return this.profiles.getValidators();
  }

  @Patch('set-role')
  @UseGuards(JwtAuthGuard)
  setRole(@CurrentUser() user: AuthUserCtx, @Body() dto: SetUserRoleDto) {
    return this.profiles.setUserRole(user.userId, dto);
  }
}
