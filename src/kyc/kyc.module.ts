import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { IdentityProvidersModule } from '../identity-providers/identity-providers.module';
import { VerificationModule } from '../verification/verification.module';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [SupabaseModule, IdentityProvidersModule, VerificationModule],
  controllers: [KycController],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
