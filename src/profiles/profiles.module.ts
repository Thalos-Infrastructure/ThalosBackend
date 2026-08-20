import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { ReputationService } from './reputation.service';

@Module({
  imports: [SupabaseModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, ReputationService],
  exports: [ProfilesService, ReputationService],
})
export class ProfilesModule {}
