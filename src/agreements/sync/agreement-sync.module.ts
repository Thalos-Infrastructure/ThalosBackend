import { Module } from '@nestjs/common';
import { AgreementSyncService } from './agreement-sync.service';
import { AgreementValidationModule } from '../validation/agreement-validation.module';
import { RetryQueueModule } from '../../common/retry/retry-queue.module';

@Module({
  imports: [AgreementValidationModule, RetryQueueModule],
  providers: [AgreementSyncService],
  exports: [AgreementSyncService],
})
export class AgreementSyncModule {}
