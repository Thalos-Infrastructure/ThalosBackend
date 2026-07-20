import { Module } from '@nestjs/common';
import { MilestoneSyncService } from './milestone-sync.service';
import { MilestoneSyncListener } from './milestone-sync.listener';
import { MilestoneSyncWebhookHandler } from './milestone-sync-webhook.handler';
import { MilestoneSyncConflictService } from './milestone-sync-conflict.service';
import { MilestoneSyncRetryService } from './milestone-sync-retry.service';

@Module({
  providers: [
    MilestoneSyncService,
    MilestoneSyncListener,
    MilestoneSyncWebhookHandler,
    MilestoneSyncConflictService,
    MilestoneSyncRetryService,
  ],
  exports: [MilestoneSyncService, MilestoneSyncWebhookHandler],
})
export class MilestoneSyncModule {}
