import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { SupabaseModule } from "./supabase/supabase.module";
import { InternalTrustlessModule } from "./internal-trustless/internal-trustless.module";
import { AgreementsModule } from "./agreements/agreements.module";
import { UsersModule } from "./users/users.module";
import { ContactsModule } from "./contacts/contacts.module";
import { NotificationsModule } from "./notifications/notifications.module";

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
  ],
})
export class AppModule {}
