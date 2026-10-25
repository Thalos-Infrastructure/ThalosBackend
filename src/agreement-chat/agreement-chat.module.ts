import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { FilesModule } from '../files/files.module';
import { AgreementChatController } from './agreement-chat.controller';
import { AgreementChatService } from './agreement-chat.service';
import { AgreementChatEvents } from './agreement-chat.events';

@Module({
  imports: [SupabaseModule, FilesModule],
  controllers: [AgreementChatController],
  providers: [AgreementChatService, AgreementChatEvents],
  exports: [AgreementChatService],
})
export class AgreementChatModule {}
