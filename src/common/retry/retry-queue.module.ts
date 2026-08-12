import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RetryQueueService } from './retry-queue.service';

@Module({
  // EventEmitterModule is registered globally in AppModule, but we declare
  // the import here for clarity and standalone usage.
  imports: [EventEmitterModule],
  providers: [RetryQueueService],
  exports: [RetryQueueService],
})
export class RetryQueueModule {}
