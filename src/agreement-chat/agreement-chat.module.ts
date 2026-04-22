import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { AgreementChatController } from "./agreement-chat.controller";
import { AgreementChatService } from "./agreement-chat.service";

@Module({
  imports: [SupabaseModule],
  controllers: [AgreementChatController],
  providers: [AgreementChatService],
  exports: [AgreementChatService],
})
export class AgreementChatModule {}
