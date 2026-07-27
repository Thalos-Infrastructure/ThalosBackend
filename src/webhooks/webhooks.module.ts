import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgreementsModule } from '../agreements/agreements.module';

@Module({
  imports: [NotificationsModule, AgreementsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
