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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUserCtx } from "../auth/current-user.decorator";
import { DisputesService } from "./disputes.service";
import {
  OpenDisputeDto,
  AssignResolverDto,
  ResolveDisputeDto,
  CancelDisputeDto,
} from "./dto/disputes.dto";

@ApiTags("disputes")
@ApiBearerAuth("bearer")
@Controller("disputes")
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  @ApiOperation({
    summary: "Open a new dispute",
    description:
      "Opens a dispute on an agreement. Only one open/under_review dispute is allowed per agreement. " +
      "Updates the agreement status to 'disputed'.",
  })
  openDispute(@CurrentUser() user: AuthUserCtx, @Body() dto: OpenDisputeDto) {
    return this.disputes.openDispute(user.userId, dto);
  }

  @Get("open")
  @ApiOperation({
    summary: "List open disputes",
    description:
      "Returns all disputes with status 'open' or 'under_review', ordered by creation date.",
  })
  getOpenDisputes(@CurrentUser() user: AuthUserCtx) {
    return this.disputes.getOpenDisputes(user.userId);
  }

  @Get("by-resolver")
  @ApiOperation({
    summary: "List disputes by resolver wallet",
    description: "Returns all disputes assigned to a specific resolver wallet.",
  })
  getByResolver(
    @CurrentUser() user: AuthUserCtx,
    @Query("wallet") resolverWallet: string
  ) {
    return this.disputes.getDisputesByResolver(user.userId, resolverWallet);
  }

  @Get("by-agreement/:agreementId")
  @ApiOperation({
    summary: "List disputes for an agreement",
    description:
      "Returns all disputes associated with a specific agreement, ordered by creation date.",
  })
  getByAgreement(
    @CurrentUser() user: AuthUserCtx,
    @Param("agreementId") agreementId: string
  ) {
    return this.disputes.getDisputesByAgreement(user.userId, agreementId);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Get dispute by ID",
    description:
      "Returns a single dispute with its resolution (if any). Includes the parent agreement details.",
  })
  getById(@CurrentUser() user: AuthUserCtx, @Param("id") id: string) {
    return this.disputes.getDisputeById(user.userId, id);
  }

  @Patch(":id/assign-resolver")
  @ApiOperation({
    summary: "Assign a resolver to a dispute",
    description:
      "Assigns a resolver wallet to an open dispute and transitions the status to 'under_review'. " +
      "Only disputes in 'open' status can have a resolver assigned.",
  })
  assignResolver(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: AssignResolverDto
  ) {
    return this.disputes.assignResolver(user.userId, id, dto);
  }

  @Patch(":id/resolve")
  @ApiOperation({
    summary: "Resolve a dispute",
    description:
      "Resolves a dispute by specifying payer and payee percentages (must sum to 100). " +
      "Creates a dispute resolution record and updates both the dispute and agreement status to 'resolved'.",
  })
  resolve(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: ResolveDisputeDto
  ) {
    return this.disputes.resolveDispute(user.userId, id, dto);
  }

  @Patch(":id/cancel")
  @ApiOperation({
    summary: "Cancel a dispute",
    description:
      "Cancels an open or under_review dispute. Only the dispute opener can cancel. " +
      "Reverts the agreement status back to 'active'. Cannot cancel a resolved dispute.",
  })
  cancel(
    @CurrentUser() user: AuthUserCtx,
    @Param("id") id: string,
    @Body() dto: CancelDisputeDto
  ) {
    return this.disputes.cancelDispute(user.userId, id, dto);
  }
}
