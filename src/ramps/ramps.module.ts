import { Module } from '@nestjs/common';
import { RampsController } from './ramps.controller';
import { RampsService } from './ramps.service';
import { LendaraClient } from './lendara.client';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [RampsController],
  providers: [RampsService, LendaraClient],
  exports: [RampsService],
})
export class RampsModule {}
