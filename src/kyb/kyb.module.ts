import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { KybController } from './kyb.controller';
import { KybService } from './kyb.service';
import { KYB_PROVIDER } from './providers/identity-provider.interface';
import { ManualIdentityProvider } from './providers/manual-identity.provider';

@Module({
  imports: [SupabaseModule],
  controllers: [KybController],
  providers: [KybService, { provide: KYB_PROVIDER, useClass: ManualIdentityProvider }],
  exports: [KybService],
})
export class KybModule {}
