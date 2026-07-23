import { IsEnum, IsOptional } from 'class-validator';
import { RetryJobStatus } from '../retry-queue.types';

export class ListRetryJobsQueryDto {
  @IsOptional()
  @IsEnum(RetryJobStatus)
  status?: RetryJobStatus;
}
