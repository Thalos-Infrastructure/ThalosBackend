import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUserCtx } from "../auth/current-user.decorator";
import { DisputesService } from "./disputes.service";
import {
  OpenDisputeDto,
  AssignResolverDto,
  ResolveDisputeDto,
  CancelDisputeDto,
} from "./dto/disputes.dto";

@Controller("disputes")
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  openDispute(@CurrentUser() user: AuthUserCtx, @Body() dto: OpenDisputeDto) {
    return this.disputes.openDispute(user.userId, dto);
  }

  @Get("open")
  getOpenDisputes(@CurrentUser() user: AuthUserCtx) {
    return this.disputes.getOpenDisputes(user.userId);
  }

  @Get("by-resolver")
  getByResolver(
    @CurrentUser() user: AuthUserCtx,
    @Query("wallet") resolverWallet: string
  ) {
    return this.disputes.getDisputesByResolver(user.userId, resolverWallet);
  }

  @Get("by-agreement/:agreementId")
  getByAgreement(
    @CurrentUser() user: AuthUserCtx,
    @Param("agreementId") agreementId: string
  ) {
    return this.disputes.getDisputesByAgreement(user.userId, agreementId);
  }

  @Get(":id")
  getById(@CurrentUser() user: AuthUserCtx, @Param("id") id: string) {
    return this.disputes.getDisputeById(user.userId, id);
  }

  @Patch(":id/assign-resolver")
  assignResolver(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: AssignResolverDto
  ) {
    return this.disputes.assignResolver(user.userId, id, dto);
  }

  @Patch(":id/resolve")
  resolve(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: ResolveDisputeDto
  ) {
    return this.disputes.resolveDispute(user.userId, id, dto);
  }

  @Patch(":id/cancel")
  cancel(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: CancelDisputeDto
  ) {
    return this.disputes.cancelDispute(user.userId, id, dto);
  }
}
