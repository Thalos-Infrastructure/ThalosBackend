import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { AgreementsService } from './agreements.service';
import { CreateAgreementDto } from './dto/create-agreement.dto';
import { LinkContractDto } from './dto/link-contract.dto';
import { ListAgreementsQueryDto } from './dto/list-agreements.dto';
import { UpdateAgreementStatusDto } from './dto/update-status.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { AgreementSyncService } from './sync/agreement-sync.service';

@ApiTags('agreements')
@ApiBearerAuth('bearer')
@Controller('agreements')
@UseGuards(JwtAuthGuard)
export class AgreementsController {
  constructor(
    private readonly agreements: AgreementsService,
    private readonly syncEngine: AgreementSyncService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateAgreementDto) {
    const result = await this.agreements.create(user.userId, dto);
    if (result.error) {
      if (typeof result.error === 'object' && 'code' in result.error) {
        throw new BadRequestException({ success: false, error: result.error });
      }
      throw new BadRequestException({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: [{ field: 'body', code: 'VALIDATION_ERROR', message: result.error }],
        },
      });
    }
    return result;
  }

  @Get()
  @ApiOperation({
    summary: 'List the authenticated user’s agreements',
    description:
      'Every agreement the user created or participates in, across all wallets they own, ' +
      'newest first. `status` and `type` are optional filters; blank values are ignored.',
  })
  list(@CurrentUser() user: AuthUserCtx, @Query() query: ListAgreementsQueryDto) {
    return this.agreements.list(user.userId, query);
  }

  @Get('by-wallet')
  listByWallet(@CurrentUser() user: AuthUserCtx, @Query('wallet') wallet: string) {
    return this.agreements.listByWallet(user.userId, wallet);
  }

  @Get('by-contract/:contractId')
  getByContract(@CurrentUser() user: AuthUserCtx, @Param('contractId') contractId: string) {
    return this.agreements.getByContractId(user.userId, contractId);
  }

  @Get(':id/activity')
  activity(@CurrentUser() user: AuthUserCtx, @Param('id') id: string) {
    return this.agreements.getActivity(user.userId, id);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUserCtx, @Param('id') id: string) {
    return this.agreements.getById(user.userId, id);
  }

  @Patch(':id/link-contract')
  linkContract(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Body() dto: LinkContractDto,
  ) {
    return this.agreements.linkContract(user.userId, id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Body() dto: UpdateAgreementStatusDto,
  ) {
    return this.agreements.updateStatus(user.userId, id, dto);
  }

  @Patch(':id/milestones')
  updateMilestone(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.agreements.updateMilestone(user.userId, id, dto);
  }

  // ── Sync & Reconciliation ─────────────────────────────────────────────

  @Post(':id/sync')
  @HttpCode(200)
  async syncAgreement(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Query('useRetryQueue') useRetryQueue?: string,
  ) {
    await this.agreements.getById(user.userId, id);
    return this.syncEngine.syncAgreement(id, {
      useRetryQueue: useRetryQueue === 'true',
    });
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  async reconcileAgreement(
    @CurrentUser() user: AuthUserCtx,
    @Param('id') id: string,
    @Query('useRetryQueue') useRetryQueue?: string,
  ) {
    await this.agreements.getById(user.userId, id);
    return this.syncEngine.reconcileAgreement(id, {
      useRetryQueue: useRetryQueue === 'true',
    });
  }
}
