import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IVerificationProvider, ProviderConfig } from './verification.provider';
import { VerificationProvider } from '../dto/verification.dto';
import { MockVerificationProvider } from './mock.provider';

export interface ProviderFactoryOptions {
  provider?: VerificationProvider;
  config?: ProviderConfig;
}

/**
 * Central registry + resolver for identity verification providers.
 *
 * - Providers register themselves here (defaults are wired in the constructor;
 *   additional providers can be added at runtime via {@link registerProvider}).
 * - The active/default provider is configurable through the
 *   `VERIFICATION_PROVIDER` environment variable (or application config),
 *   allowing operators to switch vendors without touching core code.
 * - Per-provider credentials are resolved from env using the convention
 *   `<PROVIDER>_API_KEY`, `<PROVIDER>_API_SECRET`, `<PROVIDER>_BASE_URL`,
 *   `<PROVIDER>_WEBHOOK_SECRET` (e.g. `SUMSUB_API_KEY`, `PERSONA_API_KEY`).
 */
@Injectable()
export class VerificationProviderFactory {
  private readonly logger = new Logger(VerificationProviderFactory.name);
  private readonly providers = new Map<VerificationProvider, IVerificationProvider>();

  constructor(private readonly configService: ConfigService) {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // The mock provider is always available so the abstraction is usable in
    // local/dev/test environments without any external credentials.
    this.registerProvider(new MockVerificationProvider());
  }

  /**
   * Register (or replace) a provider implementation. Concrete vendor providers
   * (Sumsub, Persona, Veriff, Synaps, Stripe Identity, Alloy, ...) plug in here.
   */
  registerProvider(provider: IVerificationProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Returns true when a provider has been registered for the given name.
   */
  hasProvider(provider: VerificationProvider): boolean {
    return this.providers.has(provider);
  }

  /**
   * The default provider name resolved from configuration.
   * Falls back to MOCK when unset or unknown.
   */
  getDefaultProviderName(): VerificationProvider {
    const configured =
      this.configService.get<string>('VERIFICATION_PROVIDER') ??
      this.configService.get<string>('DEFAULT_VERIFICATION_PROVIDER');

    if (!configured) {
      return VerificationProvider.MOCK;
    }

    const normalized = configured.toLowerCase() as VerificationProvider;
    if (!Object.values(VerificationProvider).includes(normalized)) {
      this.logger.warn(
        `Unknown VERIFICATION_PROVIDER "${configured}", falling back to "${VerificationProvider.MOCK}"`,
      );
      return VerificationProvider.MOCK;
    }

    return normalized;
  }

  /**
   * Resolve a configured provider instance. When no explicit provider is
   * requested, the configured default is used.
   */
  getProvider(options: ProviderFactoryOptions = {}): IVerificationProvider {
    const providerName = options.provider ?? this.getDefaultProviderName();
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Unsupported verification provider: ${providerName}`);
    }

    // Apply resolved configuration if the provider supports it.
    if (typeof provider.applyConfig === 'function') {
      provider.applyConfig(this.resolveConfig(providerName, options.config));
    }

    return provider;
  }

  /**
   * Resolve provider credentials from explicit overrides then environment.
   */
  private resolveConfig(
    providerName: VerificationProvider,
    overrides?: ProviderConfig,
  ): ProviderConfig {
    const prefix = providerName.toUpperCase();
    return {
      apiKey: overrides?.apiKey ?? this.configService.get<string>(`${prefix}_API_KEY`),
      apiSecret: overrides?.apiSecret ?? this.configService.get<string>(`${prefix}_API_SECRET`),
      baseUrl: overrides?.baseUrl ?? this.configService.get<string>(`${prefix}_BASE_URL`),
      webhookSecret:
        overrides?.webhookSecret ?? this.configService.get<string>(`${prefix}_WEBHOOK_SECRET`),
      timeoutMs: overrides?.timeoutMs ?? 30000,
    };
  }

  getSupportedProviders(): VerificationProvider[] {
    return Array.from(this.providers.keys());
  }
}
