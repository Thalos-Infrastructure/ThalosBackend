import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IdentityProvidersService } from './identity-providers.service';
import { IdentityProvidersController } from './identity-providers.controller';
import { KYC_PROVIDER, IKycProvider } from './interfaces/kyc-provider.interface';
import { IdentityProviderConfig } from './abstraction/IdentityConfigManager';
import { SumsubKycProvider } from './providers/SumsubKycProvider';
import { PersonaKycProvider } from './providers/PersonaKycProvider';
import { VeriffKycProvider } from './providers/VeriffKycProvider';
import { SynapsKycProvider } from './providers/SynapsKycProvider';
import { StripeKycProvider } from './providers/StripeKycProvider';
import { AlloyKycProvider } from './providers/AlloyKycProvider';

const PROVIDER_MAP: Record<string, new (config: IdentityProviderConfig) => IKycProvider> = {
  sumsub: SumsubKycProvider,
  persona: PersonaKycProvider,
  veriff: VeriffKycProvider,
  synaps: SynapsKycProvider,
  stripe: StripeKycProvider,
  alloy: AlloyKycProvider,
};

@Module({
  imports: [ConfigModule],
  controllers: [IdentityProvidersController],
  providers: [
    IdentityProvidersService,
    {
      provide: KYC_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const providerName = configService.get<string>('IDENTITY_PROVIDER', 'sumsub');
        const config: IdentityProviderConfig = {
          provider: providerName as IdentityProviderConfig['provider'],
          apiKey: configService.get<string>('IDENTITY_API_KEY', ''),
          apiSecret: configService.get<string>('IDENTITY_API_SECRET'),
          webhookSecret: configService.get<string>('IDENTITY_WEBHOOK_SECRET'),
          baseUrl: configService.get<string>('IDENTITY_BASE_URL'),
          timeout: configService.get<number>('IDENTITY_TIMEOUT'),
          levelName: configService.get<string>('IDENTITY_LEVEL_NAME'),
        };

        const ProviderClass = PROVIDER_MAP[providerName ?? 'sumsub'];
        if (!ProviderClass) {
          throw new Error(`Unsupported identity provider: ${providerName}`);
        }
        return new ProviderClass(config);
      },
    },
  ],
  exports: [IdentityProvidersService, KYC_PROVIDER],
})
export class IdentityProvidersModule {}
