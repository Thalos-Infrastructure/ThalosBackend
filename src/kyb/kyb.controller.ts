import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { KybService } from './kyb.service';
import { CreateKybSessionDto, ReviewKybSessionDto } from './dto/kyb.dto';

@ApiTags('kyb')
@ApiBearerAuth('bearer')
@Controller('kyb')
@UseGuards(JwtAuthGuard)
export class KybController {
  constructor(private readonly kyb: KybService) {}

  @Post('session')
  @ApiOperation({
    summary: 'Start (or resume) a KYB verification session for an organization',
    description:
      'Creates a new verification session via the configured IdentityProvider. If a ' +
      'pending/in_review/verified session already exists for the organization_id, it is ' +
      'returned as-is instead of creating a duplicate. A previously rejected organization ' +
      'may submit a new attempt.',
  })
  createSession(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateKybSessionDto) {
    return this.kyb.createSession(user.userId, dto);
  }

  @Get('status/:organizationId')
  @ApiOperation({ summary: 'Get the current KYB verification status for an organization' })
  getStatus(
    @CurrentUser() user: AuthUserCtx,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.kyb.getStatus(user.userId, organizationId);
  }

  @Patch('status/:organizationId')
  @ApiOperation({
    summary: 'Admin-only: transition a KYB verification to in_review/verified/rejected',
  })
  review(
    @CurrentUser() user: AuthUserCtx,
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() dto: ReviewKybSessionDto,
  ) {
    return this.kyb.review(user.userId, organizationId, dto);
  }
}
