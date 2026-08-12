import { Module } from '@nestjs/common';
import { ApiClientModule } from './api/api-client.module';
import { RetryQueueModule } from './retry/retry-queue.module';

@Module({
  imports: [ApiClientModule, RetryQueueModule],
  exports: [ApiClientModule, RetryQueueModule],
})
export class CommonModule {}
