import {
  CreateVerificationSessionInput,
  IdentityProvider,
  KybStatus,
  VerificationSessionResult,
} from './identity-provider.interface';

export type MockIdentityProviderBehavior = {
  /** Provider name written to kyb_verifications.provider (e.g. persona, sumsub, onfido). */
  name?: string;
  /** Result of createVerificationSession, or a factory for per-call control. */
  createResult?:
    | VerificationSessionResult
    | ((input: CreateVerificationSessionInput) => VerificationSessionResult);
  /** Error thrown from createVerificationSession (provider outage / 5xx). */
  createError?: Error;
  /** Status returned by checkStatus, or a factory. */
  checkStatusResult?: KybStatus | ((providerSessionId: string) => KybStatus);
  /** Error thrown from checkStatus. */
  checkStatusError?: Error;
};

/**
 * Configurable IdentityProvider for integration tests.
 *
 * Swap DI binding `{ provide: KYB_PROVIDER, useValue: new MockIdentityProvider(...) }`
 * to exercise success, failure, instant-verify, and multi-vendor paths without a live vendor.
 */
export class MockIdentityProvider implements IdentityProvider {
  readonly name: string;
  createCalls: CreateVerificationSessionInput[] = [];
  checkStatusCalls: string[] = [];

  constructor(private readonly behavior: MockIdentityProviderBehavior = {}) {
    this.name = behavior.name ?? 'mock';
  }

  createVerificationSession(
    input: CreateVerificationSessionInput,
  ): Promise<VerificationSessionResult> {
    this.createCalls.push(input);
    if (this.behavior.createError) {
      return Promise.reject(this.behavior.createError);
    }
    const result =
      typeof this.behavior.createResult === 'function'
        ? this.behavior.createResult(input)
        : (this.behavior.createResult ?? {
            providerSessionId: `mock-${this.name}-${this.createCalls.length}`,
            redirectUrl: `https://${this.name}.example/session`,
            initialStatus: 'pending' as KybStatus,
          });
    return Promise.resolve(result);
  }

  checkStatus(providerSessionId: string): Promise<KybStatus> {
    this.checkStatusCalls.push(providerSessionId);
    if (this.behavior.checkStatusError) {
      return Promise.reject(this.behavior.checkStatusError);
    }
    const result =
      typeof this.behavior.checkStatusResult === 'function'
        ? this.behavior.checkStatusResult(providerSessionId)
        : (this.behavior.checkStatusResult ?? 'pending');
    return Promise.resolve(result);
  }
}
