import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IVerificationProvider, ProviderConfig } from './verification.provider';
import { VerificationProvider } from '../dto/verification.dto';
import { MockVerificationProvider } from './mock.provider';

export interface ProviderFactoryOptions {
  provider?: VerificationProvider;
  config?: ProviderConfig;
}

@Injectable()
export class VerificationProviderFactory {
  private providers: Map<VerificationProvider, IVerificationProvider> = new Map();

  constructor(private configService: ConfigService) {
    this.registerDefaults();
  }

  private registerDefaults() {
    this.providers.set(VerificationProvider.MOCK, new MockVerificationProvider());
  }

  registerProvider(provider: IVerificationProvider) {
    this.providers.set(provider.name, provider);
  }

  getProvider(options: ProviderFactoryOptions = {}): IVerificationProvider {
    const providerName = options.provider || VerificationProvider.MOCK;
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Unsupported verification provider: ${providerName}`);
    }

    const _config: ProviderConfig = {
      apiKey:
        options.config?.apiKey ||
        this.configService.get<string>(`${providerName.toUpperCase()}_API_KEY`),
      apiSecret:
        options.config?.apiSecret ||
        this.configService.get<string>(`${providerName.toUpperCase()}_API_SECRET`),
      baseUrl:
        options.config?.baseUrl ||
        this.configService.get<string>(`${providerName.toUpperCase()}_BASE_URL`),
      webhookSecret:
        options.config?.webhookSecret ||
        this.configService.get<string>(`${providerName.toUpperCase()}_WEBHOOK_SECRET`),
      timeoutMs: options.config?.timeoutMs || 30000,
    };

    if (provider instanceof MockVerificationProvider) {
      // Configure the existing mock provider instance instead of creating a new one
      provider.configure({
        // Note: We're not using the config directly in the mock provider for simplicity
        // In a real implementation, you might want to use these values
        // For now, we just return the configured instance
      });
      return provider;
    }

    return provider;
  }

  getSupportedProviders(): VerificationProvider[] {
    return Array.from(this.providers.keys());
  }
}
