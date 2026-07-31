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

  constructor(env: Record<string, unknown>) {
    const e = env as Record<string, string>;
    this.config = {
      provider: (e.IDENTITY_PROVIDER || 'sumsub') as ProviderName,
      apiKey: e.IDENTITY_API_KEY || '',
      apiSecret: e.IDENTITY_API_SECRET || '',
      webhookSecret: e.IDENTITY_WEBHOOK_SECRET || '',
      baseUrl: e.IDENTITY_BASE_URL || '',
      timeout: parseInt(e.IDENTITY_TIMEOUT || '30000', 10),
      levelName: e.IDENTITY_LEVEL_NAME || 'basic-kyc-level',
    };
    this.validateConfig();
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
