import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { ApplicationsService } from './applications.service';
import {
  CreateApplicationDto,
  ListApplicationsQueryDto,
  UpdateApplicationStatusDto,
} from './dto/applications.dto';

@ApiTags('applications')
@ApiBearerAuth('bearer')
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  // POST /v1/applications
  @Post()
  @ApiOperation({
    summary: 'Apply to an opportunity',
    description:
      'A builder submits an application for an opportunity. ' +
      'Each (opportunity, builder) pair is unique — duplicates are rejected with 409.',
  })
  apply(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateApplicationDto) {
    return this.applications.apply(user.userId, dto);
  }

  // GET /v1/applications?opportunity_id=<uuid>
  @Get()
  @ApiOperation({
    summary: 'List applicants for an opportunity',
    description:
      'Returns all applications for a given opportunity. ' +
      'Only the opportunity owner (Project) may call this endpoint.',
  })
  @ApiQuery({
    name: 'opportunity_id',
    required: true,
    description: 'UUID of the opportunity whose applicants to list',
  })
  listApplicants(@CurrentUser() user: AuthUserCtx, @Query() query: ListApplicationsQueryDto) {
    return this.applications.listApplicants(user.userId, query);
  }

  // PATCH /v1/applications/:id
  @Patch(':id')
  @ApiOperation({
    summary: 'Accept or reject an application',
    description:
      'The opportunity owner accepts or rejects a pending application. ' +
      'Accepting marks the opportunity as filled and signals the frontend to ' +
      'pre-fill the existing Thalos Agreement creation flow. ' +
      'No new on-chain path is created by this endpoint.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the application', type: 'string' })
  updateStatus(
    @CurrentUser() user: AuthUserCtx,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    return this.applications.updateStatus(user.userId, id, dto);
  }
}
