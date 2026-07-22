import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  OnModuleInit,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RetryQueueService } from '../retry-queue/retry-queue.service';
import { RetryJobType } from '../retry-queue/retry-queue.types';
import { relayToTrustless } from './trustless-relay.helper';
import * as escrowWrite from './escrow-write.helper';
import { RelayRequest, TrustlessRelayError } from './escrow-write.helper';
import {
  ApproveMilestoneDto,
  ChangeMilestoneStatusDto,
  CreateEscrowDto,
  DisputeMilestoneDto,
  FundEscrowDto,
  ReleaseFundsDto,
  SendTransactionDto,
} from './dto/escrow-write.dto';

@ApiTags('escrows')
@ApiBearerAuth('bearer')
@Controller('escrows')
@UseGuards(JwtAuthGuard)
export class EscrowsController implements OnModuleInit {
  // NOTE: write endpoints require a valid JWT (class-level JwtAuthGuard) but do NOT
  // bind the JWT user to `signer`. Authorization of the actual signer is enforced by
  // the on-chain signature: build endpoints only return an UNSIGNED XDR, and the
  // transaction is only effective once signed by the signer's wallet (validated
  // on-chain when submitted via /escrows/send-transaction).
  constructor(private readonly retryQueue: RetryQueueService) {}

  onModuleInit(): void {
    // One generic handler per bucket: it just replays the same {path, body} against
    // Trustless Work, so create/fund/approve/change-status/release can share it.
    const replay = (payload: RelayRequest) => escrowWrite.relayWrite(payload.path, payload.body);
    this.retryQueue.registerHandler<RelayRequest>(RetryJobType.AGREEMENT_CREATION, replay);
    this.retryQueue.registerHandler<RelayRequest>(RetryJobType.MILESTONE_UPDATE, replay);
    this.retryQueue.registerHandler<RelayRequest>(RetryJobType.PAYMENT_EXECUTION, replay);
  }

  /**
   * Runs a Trustless Work write inline (unchanged happy path — the caller still gets the
   * result, e.g. the unsigned XDR, synchronously). On a transient failure (TW 5xx or a
   * network-level error) it also enqueues a backstop job on the shared retry queue so the
   * operation isn't silently dropped, then re-throws the original error to the client.
   * Validation errors (4xx) are re-thrown as-is — retrying those can't help.
   */
  private async writeWithBackstop(
    jobType: RetryJobType,
    idempotencyKey: string,
    request: RelayRequest,
  ): Promise<unknown> {
    try {
      return await escrowWrite.relayWrite(request.path, request.body);
    } catch (error) {
      if (error instanceof TrustlessRelayError && error.upstreamStatus < 500) {
        throw error;
      }
      await this.retryQueue.enqueue<RelayRequest>(jobType, request, idempotencyKey);
      throw error;
    }
  }

  @Get('by-signer/:address')
  async getEscrowsBySigner(
    @Param('address') address: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('validateOnChain') validateOnChain?: string,
  ) {
    // Trustless Work's helper expects `signer` (NOT `address`) plus pagination
    // flags; sending `address` makes TW reject with "property address should not
    // exist" (400), which used to force the frontend to fall back to calling TW
    // directly. Defaults mirror the original frontend service.
    const result = await relayToTrustless('GET', 'helper/get-escrows-by-signer', {
      signer: address,
      page: page ?? 1,
      pageSize: pageSize ?? 5,
      validateOnChain: validateOnChain ?? true,
    });
    if (result.status >= 400) throw new BadRequestException(result.data);
    return result.data;
  }

  // Trustless Work expects role values in camelCase (e.g. `serviceProvider`).
  // The frontend/app uses snake_case, so normalize here — the backend owns the TW
  // contract. Sending `service_provider` queries a non-existent `roles.service_provider`
  // field and TW returns a misleading 500 "query requires an index".
  private static readonly TW_ROLE_MAP: Record<string, string> = {
    service_provider: 'serviceProvider',
    release_signer: 'releaseSigner',
    dispute_resolver: 'disputeResolver',
  };

  @Get('by-role')
  async getEscrowsByRole(
    @Query('address') address: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('type') type?: 'single-release' | 'multi-release',
  ) {
    // TW's helper filters a role by `roleAddress` (NOT `address`).
    const query: Record<string, string | number | boolean> = { roleAddress: address };
    if (role) query.role = EscrowsController.TW_ROLE_MAP[role] ?? role;
    if (status) query.status = status;
    if (type) query.type = type;
    const result = await relayToTrustless('GET', 'helper/get-escrows-by-role', query);
    if (result.status >= 400) throw new BadRequestException(result.data);
    return result.data;
  }

  /**
   * POST /escrows/create
   * Deploy un nuevo escrow (single o multi release). Devuelve { unsignedTransaction }.
   */
  @Post('create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Crear escrow (devuelve XDR sin firmar)' })
  async createEscrow(@Body() dto: CreateEscrowDto) {
    const request = escrowWrite.buildCreateEscrowRequest(dto);
    const engagementId = (request.body as { engagementId: string }).engagementId;
    return this.writeWithBackstop(
      RetryJobType.AGREEMENT_CREATION,
      `agreement_creation:${engagementId}`,
      request,
    );
  }

  /**
   * POST /escrows/fund
   * Fondear un escrow. Devuelve { unsignedTransaction }.
   */
  @Post('fund')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fondear escrow (devuelve XDR sin firmar)' })
  async fundEscrow(@Body() dto: FundEscrowDto) {
    return this.writeWithBackstop(
      RetryJobType.PAYMENT_EXECUTION,
      `payment_execution:fund:${dto.contractId}:${dto.signer}:${dto.amount}`,
      escrowWrite.buildFundEscrowRequest(dto),
    );
  }

  /**
   * POST /escrows/approve-milestone
   * Aprobar un milestone. Devuelve { unsignedTransaction }.
   */
  @Post('approve-milestone')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprobar milestone (devuelve XDR sin firmar)' })
  async approveMilestone(@Body() dto: ApproveMilestoneDto) {
    return this.writeWithBackstop(
      RetryJobType.MILESTONE_UPDATE,
      `milestone_update:approve:${dto.contractId}:${dto.milestoneIndex}`,
      escrowWrite.buildApproveMilestoneRequest(dto),
    );
  }

  /**
   * POST /escrows/change-milestone-status
   * Cambiar el estado de un milestone (evidencia + status). Devuelve { unsignedTransaction }.
   */
  @Post('change-milestone-status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cambiar estado de milestone (devuelve XDR sin firmar)' })
  async changeMilestoneStatus(@Body() dto: ChangeMilestoneStatusDto) {
    return this.writeWithBackstop(
      RetryJobType.MILESTONE_UPDATE,
      `milestone_update:status:${dto.contractId}:${dto.milestoneIndex}:${dto.newStatus}`,
      escrowWrite.buildChangeMilestoneStatusRequest(dto),
    );
  }

  /**
   * POST /escrows/release
   * Liberar fondos (single: todo; multi: por milestone). Devuelve { unsignedTransaction }.
   */
  @Post('release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Liberar fondos (devuelve XDR sin firmar)' })
  async releaseFunds(@Body() dto: ReleaseFundsDto) {
    return this.writeWithBackstop(
      RetryJobType.PAYMENT_EXECUTION,
      `payment_execution:release:${dto.contractId}:${dto.releaseSigner}:${dto.milestoneIndex ?? 'all'}`,
      escrowWrite.buildReleaseFundsRequest(dto),
    );
  }

  /**
   * POST /escrows/dispute
   * Abrir disputa sobre un milestone. Devuelve { unsignedTransaction }.
   */
  @Post('dispute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disputar milestone (devuelve XDR sin firmar)' })
  async disputeMilestone(@Body() dto: DisputeMilestoneDto) {
    return escrowWrite.disputeMilestone(dto);
  }

  /**
   * POST /escrows/send-transaction
   * Enviar a la red el XDR ya firmado en el cliente.
   */
  @Post('send-transaction')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enviar transacción firmada (XDR)' })
  async sendTransaction(@Body() dto: SendTransactionDto) {
    return escrowWrite.sendTransaction(dto);
  }
}
