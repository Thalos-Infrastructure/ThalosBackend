import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtOrInternalSecretGuard } from './jwt-or-internal-secret.guard';
import { AuthUserCtx } from '../auth/current-user.decorator';
import { VerificationService } from './verification.service';
import { VerificationAccessContext, VerificationStatusResponse } from './verification.types';

@ApiTags('verification')
@ApiBearerAuth('bearer')
@ApiSecurity('thalos-internal')
@UseGuards(JwtOrInternalSecretGuard)
@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get('user/:id')
  @ApiOperation({
    summary: 'KYC status for an individual user',
    description:
      'Standardized, provider-agnostic compliance status for a user. Always 200 — an unknown or unverified subject returns an `unverified` payload rather than 404. Restricted to the user themselves, an admin, or an internal service; other callers get 403.',
  })
  @ApiParam({ name: 'id', description: 'User (profile) UUID', format: 'uuid' })
  getUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<VerificationStatusResponse> {
    return this.verification.getUserVerification(id, accessContext(req));
  }

  @Get('business/:id')
  @ApiOperation({
    summary: 'KYB status for an organization',
    description:
      'Standardized, provider-agnostic compliance status for a business. Always 200 — an unknown or unverified subject returns an `unverified` payload rather than 404. Restricted to an admin or an internal service; other callers get 403.',
  })
  @ApiParam({ name: 'id', description: 'Business (organization) UUID', format: 'uuid' })
  getBusiness(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ): Promise<VerificationStatusResponse> {
    return this.verification.getBusinessVerification(id, accessContext(req));
  }
}

/** Builds the access context the guard left on the request (JWT user and/or internal-service flag). */
function accessContext(req: Request): VerificationAccessContext {
  const typed = req as Request & { user?: AuthUserCtx; isInternalService?: boolean };
  return {
    callerUserId: typed.user?.userId,
    isInternalService: typed.isInternalService === true,
  };
}
