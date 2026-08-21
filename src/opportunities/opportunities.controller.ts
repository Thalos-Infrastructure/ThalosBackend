import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateOpportunityDto,
  DiscoverOpportunitiesQueryDto,
  UpdateOpportunityDto,
} from './dto/opportunities.dto';
import { OpportunitiesService } from './opportunities.service';

@ApiTags('opportunities')
@ApiBearerAuth('bearer')
@Controller('opportunities')
@UseGuards(JwtAuthGuard)
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get()
  @ApiOperation({
    summary: 'Discover open opportunities',
    description:
      'Connect directory list. Always scoped to status=open. Supports skills, engagement_type, budget range, text search, and pagination.',
  })
  discover(@Query() query: DiscoverOpportunitiesQueryDto) {
    return this.opportunities.discover(query);
  }

  @Get('mine')
  @ApiOperation({ summary: 'List opportunities owned by the authenticated Project (all statuses)' })
  listMine(@CurrentUser() user: AuthUserCtx) {
    return this.opportunities.listMine(user.userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get an opportunity',
    description:
      'Open opportunities are visible to any authenticated user. Closed/filled return 404 unless the caller is the owner.',
  })
  getOne(@CurrentUser() user: AuthUserCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.opportunities.getById(user.userId, id);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an opportunity for the authenticated Project' })
  create(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateOpportunityDto) {
    return this.opportunities.create(user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an opportunity or transition status (owner only)',
    description: 'Field edits require status=open. Status may move open → closed or open → filled.',
  })
  update(
    @CurrentUser() user: AuthUserCtx,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.opportunities.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an opportunity (owner only)' })
  remove(@CurrentUser() user: AuthUserCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.opportunities.remove(user.userId, id);
  }
}
