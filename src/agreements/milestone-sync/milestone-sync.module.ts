import { Module } from '@nestjs/common';
import { MilestoneSyncService } from './milestone-sync.service';
import { RetryQueueModule } from '../../common/retry/retry-queue.module';

@Module({
  imports: [RetryQueueModule],
  providers: [MilestoneSyncService],
  exports: [MilestoneSyncService],
})
export class MilestoneSyncModule {}
