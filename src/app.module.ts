import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { SupabaseModule } from './supabase/supabase.module';
import { InternalTrustlessModule } from './internal-trustless/internal-trustless.module';
import { AgreementsModule } from './agreements/agreements.module';
import { UsersModule } from './users/users.module';
import { ContactsModule } from './contacts/contacts.module';
import { RootController } from './root.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { AgreementChatModule } from './agreement-chat/agreement-chat.module';
import { DisputesModule } from './disputes/disputes.module';
import { ProfilesModule } from './profiles/profiles.module';
import { WalletsModule } from './wallets/wallets.module';
import { EventsModule } from './events/events.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { KybModule } from './kyb/kyb.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    EventEmitterModule.forRoot(),
    CommonModule,
    SupabaseModule,
    AuthModule,
    InternalTrustlessModule,
    AgreementsModule,
    UsersModule,
    ContactsModule,
    NotificationsModule,
    AgreementChatModule,
    DisputesModule,
    ProfilesModule,
    WalletsModule,
    EventsModule,
    WebhooksModule,
    KybModule,
  ],
  controllers: [RootController],
})
export class AppModule {}
