import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { DisputesService } from './disputes.service';
import {
  OpenDisputeDto,
  AssignResolverDto,
  ResolveDisputeDto,
  CancelDisputeDto,
  ProposeSettlementDto,
  RespondProposalDto,
} from './dto/disputes.dto';

@ApiTags('disputes')
@ApiBearerAuth('bearer')
@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  @ApiOperation({
    summary: 'Open a new dispute',
    description:
      'Opens a dispute on an agreement. Only one open/under_review dispute is allowed per agreement. ' +
      "Updates the agreement status to 'disputed'.",
  })
  openDispute(@CurrentUser() user: AuthUserCtx, @Body() dto: OpenDisputeDto) {
    return this.disputes.openDispute(user.userId, dto);
  }

  @Get('open')
  getOpenDisputes(@CurrentUser() user: AuthUserCtx) {
    return this.disputes.getOpenDisputes(user.userId);
  }

  @Get('by-resolver')
  getByResolver(@CurrentUser() user: AuthUserCtx, @Query('wallet') resolverWallet: string) {
    return this.disputes.getDisputesByResolver(user.userId, resolverWallet);
  }

  @Get('by-agreement/:agreementId')
  getByAgreement(@CurrentUser() user: AuthUserCtx, @Param('agreementId') agreementId: string) {
    return this.disputes.getDisputesByAgreement(user.userId, agreementId);
  }

  @Get(':id')
  getById(@CurrentUser() user: AuthUserCtx, @Param('id') id: string) {
    return this.disputes.getDisputeById(user.userId, id);
  }

  @Post(':id/proposals')
  @ApiOperation({
    summary: 'Propose a split',
    description:
      'Records an off-chain offer (percentages must sum to 100). Does not sign Trustless Work.',
  })
  proposeSettlement(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Body() dto: ProposeSettlementDto,
  ) {
    return this.disputes.proposeSettlement(user.userId, id, dto);
  }

  @Post(':id/proposals/:proposalId/accept')
  @ApiOperation({
    summary: 'Accept a split offer',
    description:
      'The other party accepts. Funds still move only when wallets sign resolve_dispute.',
  })
  acceptProposal(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: RespondProposalDto,
  ) {
    return this.disputes.acceptProposal(user.userId, id, proposalId, dto);
  }

  @Post(':id/proposals/:proposalId/reject')
  rejectProposal(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: RespondProposalDto,
  ) {
    return this.disputes.rejectProposal(user.userId, id, proposalId, dto);
  }

  @Patch(':id/assign-resolver')
  assignResolver(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Body() dto: AssignResolverDto,
  ) {
    return this.disputes.assignResolver(user.userId, id, dto);
  }

  @Patch(':id/resolve')
  resolve(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputes.resolveDispute(user.userId, id, dto);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() user: AuthUserCtx, @Param('id') id: string, @Body() dto: CancelDisputeDto) {
    return this.disputes.cancelDispute(user.userId, id, dto);
  }
}
