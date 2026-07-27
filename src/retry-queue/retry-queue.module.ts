import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RetryQueueController } from './retry-queue.controller';
import { RetryQueueService } from './retry-queue.service';

/**
 * Foundational, shared module: the single retry/recovery primitive for Trustless
 * Work operations. @Global() so any module can inject RetryQueueService without
 * re-importing this module, matching SupabaseModule's precedent for backend-wide
 * infrastructure.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [RetryQueueController],
  providers: [RetryQueueService],
  exports: [RetryQueueService],
})
export class RetryQueueModule {}
