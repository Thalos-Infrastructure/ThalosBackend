import { Module } from '@nestjs/common';
import { AgreementEventsListener } from './agreement-events.listener';

@Module({
  providers: [AgreementEventsListener],
})
export class EventsModule {}
