import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { SupabaseModule } from "./supabase/supabase.module";
import { InternalTrustlessModule } from "./internal-trustless/internal-trustless.module";
import { AgreementsModule } from "./agreements/agreements.module";
import { UsersModule } from "./users/users.module";
import { ContactsModule } from "./contacts/contacts.module";
import { RootController } from "./root.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { AgreementChatModule } from "./agreement-chat/agreement-chat.module";
import { DisputesModule } from "./disputes/disputes.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { WalletsModule } from "./wallets/wallets.module";

@Module({
  imports: [
    // Load `.env.local` first so local overrides win, then fall back to `.env`.
    // Keeps `.env` as the canonical set of defaults across environments while
    // letting each developer (or ephemeral deploy) tweak `.env.local` without
    // committing secrets. Variable names match the frontend convention used by
    // `lib/email/resend.ts`.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
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
  ],
  controllers: [RootController],
})
export class AppModule {}
