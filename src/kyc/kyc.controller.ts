import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { KycService } from './kyc.service';
import { CreateKycSessionDto } from './dto/kyc.dto';

@ApiTags('kyc')
@ApiBearerAuth('bearer')
@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post('session')
  @ApiOperation({
    summary: 'Start (or resume) a KYC verification session for a person',
    description:
      'Creates a new verification session via the configured IdentityProvider. If a ' +
      'pending/in_review/verified session already exists for the authenticated user, it is ' +
      'returned as-is instead of creating a duplicate. A previously rejected user ' +
      'may submit a new attempt.',
  })
  createSession(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateKycSessionDto) {
    return this.kyc.createSession(user.userId, dto);
  }
}
