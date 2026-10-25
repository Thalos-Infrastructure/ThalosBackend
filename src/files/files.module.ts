import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { SupabaseModule } from '../supabase/supabase.module';

/**
 * File storage, shared rather than owned by the chat.
 *
 * Chat attachments are the first consumer; milestone evidence (a plain URL
 * field today) is the next one, and it should reuse this instead of growing a
 * second upload path.
 */
@Module({
  imports: [SupabaseModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
