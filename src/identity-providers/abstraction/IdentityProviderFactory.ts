import { IdentityVerificationProvider } from './IdentityProvider';

export class IdentityProviderFactory {
  private providers = new Map<string, new (config: unknown) => IdentityVerificationProvider>();

  register(name: string, Provider: new (config: unknown) => IdentityVerificationProvider) {
    this.providers.set(name.toLowerCase(), Provider);
  }

  create(name: string, config: unknown): IdentityVerificationProvider {
    const ProviderClass = this.providers.get(name.toLowerCase());
    if (!ProviderClass) {
      const available = Array.from(this.providers.keys()).join(', ');
      throw new Error(`Identity provider '${name}' not registered. Available: [${available}]`);
    }
    return new ProviderClass(config);
  }

  getSupportedProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
