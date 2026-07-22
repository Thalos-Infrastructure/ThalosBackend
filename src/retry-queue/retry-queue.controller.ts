import { Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { RetryQueueService } from './retry-queue.service';
import { ListRetryJobsQueryDto } from './dto/list-retry-jobs-query.dto';

@ApiTags('retry-queue')
@ApiBearerAuth('bearer')
@Controller('retry-queue')
@UseGuards(JwtAuthGuard)
export class RetryQueueController {
  constructor(private readonly retryQueue: RetryQueueService) {}

  @Get()
  async list(@CurrentUser() user: AuthUserCtx, @Query() query: ListRetryJobsQueryDto) {
    await this.retryQueue.assertAdmin(user.userId);
    return { jobs: await this.retryQueue.listJobs(query.status) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthUserCtx, @Param('id') id: string) {
    await this.retryQueue.assertAdmin(user.userId);
    const job = await this.retryQueue.getJob(id);
    if (!job) throw new NotFoundException(`Retry job ${id} not found`);
    return { job };
  }

  @Post(':id/retry')
  async retry(@CurrentUser() user: AuthUserCtx, @Param('id') id: string) {
    await this.retryQueue.assertAdmin(user.userId);
    const job = await this.retryQueue.manualRetry(id);
    return { job };
  }
}
