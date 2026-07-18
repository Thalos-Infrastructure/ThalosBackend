import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from '../supabase/supabase.module';
import { WalletsModule } from '../wallets/wallets.module';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VerificationProviderFactory } from './providers/provider-factory';

@Module({
  imports: [ConfigModule, SupabaseModule, WalletsModule],
  controllers: [VerificationController],
  providers: [VerificationService, VerificationProviderFactory],
  exports: [VerificationService, VerificationProviderFactory],
})
export class VerificationModule {}
