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
import { AgreementsService } from "./agreements.service";
import { CreateAgreementDto } from "./dto/create-agreement.dto";
import { LinkContractDto } from "./dto/link-contract.dto";
import { UpdateAgreementStatusDto } from "./dto/update-status.dto";
import { UpdateMilestoneDto } from "./dto/update-milestone.dto";

@Controller("agreements")
@UseGuards(JwtAuthGuard)
export class AgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Post()
  create(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateAgreementDto) {
    return this.agreements.create(user.userId, dto);
  }

  @Get("by-wallet")
  listByWallet(
    @CurrentUser() user: AuthUserCtx,
    @Query("wallet") wallet: string,
  ) {
    return this.agreements.listByWallet(user.userId, wallet);
  }

  @Get("by-contract/:contractId")
  getByContract(
    @CurrentUser() user: AuthUserCtx,
    @Param("contractId") contractId: string,
  ) {
    return this.agreements.getByContractId(user.userId, contractId);
  }

  @Get(":id/activity")
  activity(@CurrentUser() user: AuthUserCtx, @Param("id") id: string) {
    return this.agreements.getActivity(user.userId, id);
  }

  @Get(":id")
  getOne(@CurrentUser() user: AuthUserCtx, @Param("id") id: string) {
    return this.agreements.getById(user.userId, id);
  }

  @Patch(":id/link-contract")
  linkContract(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: LinkContractDto,
  ) {
    return this.agreements.linkContract(user.userId, id, dto);
  }

  @Patch(":id/status")
  updateStatus(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: UpdateAgreementStatusDto,
  ) {
    return this.agreements.updateStatus(user.userId, id, dto);
  }

  @Patch(":id/milestones")
  updateMilestone(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.agreements.updateMilestone(user.userId, id, dto);
  }
}
