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
import { BountiesService } from "./bounties.service";
import {
  CreateBountyDto,
  LinkContractToBountyDto,
  SubmitToBountyDto,
  ValidateSubmissionDto,
  UpdateBountyStatusDto,
} from "./dto/bounties.dto";

@Controller("bounties")
export class BountiesController {
  constructor(private readonly bounties: BountiesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateBountyDto) {
    return this.bounties.create(user.userId, dto);
  }

  // Public endpoint - bounties can be viewed by slug without auth
  @Get("by-slug/:slug")
  getBySlug(@Param("slug") slug: string) {
    return this.bounties.getBySlug(slug);
  }

  @Get("open")
  getOpenBounties() {
    return this.bounties.getOpenBounties();
  }

  @Get("by-creator")
  @UseGuards(JwtAuthGuard)
  getByCreator(
    @CurrentUser() user: AuthUserCtx,
    @Query("wallet") wallet: string
  ) {
    return this.bounties.getBountiesByCreator(user.userId, wallet);
  }

  @Get("for-validator")
  @UseGuards(JwtAuthGuard)
  getForValidator(
    @CurrentUser() user: AuthUserCtx,
    @Query("wallet") wallet: string
  ) {
    return this.bounties.getBountiesForValidator(user.userId, wallet);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  getById(@Param("id") id: string) {
    return this.bounties.getById(id);
  }

  @Patch(":id/link-contract")
  @UseGuards(JwtAuthGuard)
  linkContract(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: LinkContractToBountyDto
  ) {
    return this.bounties.linkContract(user.userId, id, dto);
  }

  @Patch(":id/status")
  @UseGuards(JwtAuthGuard)
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateBountyStatusDto
  ) {
    return this.bounties.updateStatus(id, dto.status as any);
  }

  @Post(":id/submissions")
  @UseGuards(JwtAuthGuard)
  submit(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: SubmitToBountyDto
  ) {
    return this.bounties.submitToBounty(user.userId, id, dto);
  }

  @Patch("submissions/:submissionId/validate")
  @UseGuards(JwtAuthGuard)
  validateSubmission(
    @CurrentUser() user: AuthUserCtx,
    @Param("submissionId") submissionId: string,
    @Body() dto: ValidateSubmissionDto
  ) {
    return this.bounties.validateSubmission(user.userId, submissionId, dto);
  }
}
