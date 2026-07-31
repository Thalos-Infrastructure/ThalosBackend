export type ProviderName = 'sumsub' | 'persona' | 'veriff' | 'synaps' | 'stripe' | 'alloy';

export interface IdentityProviderConfig {
  provider: ProviderName;
  apiKey: string;
  apiSecret?: string;
  webhookSecret?: string;
  baseUrl?: string;
  timeout?: number;
  levelName?: string;
  [key: string]: unknown;
}

export class IdentityConfigManager {
  private config: IdentityProviderConfig;

  /** Construct from raw env vars (process.env shape). */
  constructor(env: Record<string, unknown>);
  /** Construct from an already-parsed config object. */
  constructor(config: IdentityProviderConfig);
  constructor(input: Record<string, unknown> | IdentityProviderConfig) {
    if (this.isEnv(input)) {
      this.config = this.fromEnv(input);
    } else {
      this.config = input as IdentityProviderConfig;
    }
    this.validateConfig();
  }

  private isEnv(
    input: Record<string, unknown> | IdentityProviderConfig,
  ): input is Record<string, string> {
    return 'IDENTITY_PROVIDER' in input || 'IDENTITY_API_KEY' in input;
  }

  private fromEnv(env: Record<string, string>): IdentityProviderConfig {
    return {
      provider: (env.IDENTITY_PROVIDER || 'sumsub') as ProviderName,
      apiKey: env.IDENTITY_API_KEY || '',
      apiSecret: env.IDENTITY_API_SECRET || '',
      webhookSecret: env.IDENTITY_WEBHOOK_SECRET || '',
      baseUrl: env.IDENTITY_BASE_URL || '',
      timeout: parseInt(env.IDENTITY_TIMEOUT || '30000', 10),
      levelName: env.IDENTITY_LEVEL_NAME || 'basic-kyc-level',
    };
  }

  private validateConfig() {
    if (!this.config.provider) throw new Error('IDENTITY_PROVIDER is required');
    if (!this.config.apiKey) throw new Error('IDENTITY_API_KEY is required');
    if (this.config.provider === 'sumsub' && !this.config.apiSecret) {
      throw new Error('IDENTITY_API_SECRET is required for Sumsub');
    }
  }

  getConfig(): IdentityProviderConfig {
    return this.config;
  }

  updateConfig(updates: Partial<IdentityProviderConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateConfig();
  }
}
