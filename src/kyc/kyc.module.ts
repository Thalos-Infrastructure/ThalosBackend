import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { MockKycProvider } from './providers/mock-kyc.provider';
import { KYC_PROVIDER } from './interfaces/identity-provider.interface';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SupabaseModule, AuthModule],
  controllers: [KycController],
  providers: [
    KycService,
    { provide: KYC_PROVIDER, useClass: MockKycProvider },
  ],
  exports: [KycService],
})
export class KycModule {}
