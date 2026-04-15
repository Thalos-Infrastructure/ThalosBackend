import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { SupabaseModule } from "./supabase/supabase.module";
import { InternalTrustlessModule } from "./internal-trustless/internal-trustless.module";
import { AgreementsModule } from "./agreements/agreements.module";
import { UsersModule } from "./users/users.module";
import { ContactsModule } from "./contacts/contacts.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AgreementChatModule } from "./agreement-chat/agreement-chat.module";
import { DisputesModule } from "./disputes/disputes.module";
import { ProfilesModule } from "./profiles/profiles.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
})
export class AppModule {}
