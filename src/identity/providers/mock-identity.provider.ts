import { IdentityProvider } from '../interfaces/identity-provider.interface';
import {
  CreateSessionInput,
  CreateSessionResult,
  CheckStatusInput,
  VerificationResult,
  GetResultInput,
  CancelSessionInput,
  ResendNotificationInput,
  IdentityProviderConfig,
  IdentityVerificationStatus,
  IdentityVerificationLevel,
} from '../types/identity.types';

/**
 * Configurable behaviour for MockIdentityProvider.
 */
export type MockIdentityProviderBehavior = {
  /** Provider name (default: 'mock'). */
  name?: string;
  /** Whether this mock supports KYC (default: true). */
  supportsKyc?: boolean;
  /** Whether this mock supports KYB (default: true). */
  supportsKyb?: boolean;
  /** Max verification level (default: 'advanced'). */
  maxLevel?: IdentityVerificationLevel;
  /** Result of createSession, or a factory for per-call control. */
  createResult?:
    | CreateSessionResult
    | ((input: CreateSessionInput) => CreateSessionResult);
  /** Error thrown from createSession (provider outage / 5xx). */
  createError?: Error;
  /** Status returned by checkStatus, or a factory. */
  checkStatusResult?:
    | VerificationResult
    | ((input: CheckStatusInput) => VerificationResult);
  /** Error thrown from checkStatus. */
  checkStatusError?: Error;
  /** Result returned by getResult, or a factory. */
  getResultResult?:
    | VerificationResult
    | ((input: GetResultInput) => VerificationResult);
  /** Error thrown from getResult. */
  getResultError?: Error;
};

/**
 * Configurable IdentityProvider for integration tests.
 *
 * Swap DI binding `{ provide: IDENTITY_PROVIDER, useValue: new MockIdentityProvider(...) }`
 * to exercise success, failure, instant-verify, and multi-vendor paths without a live vendor.
 *
 * @module IdentityProvider
 */
export class MockIdentityProvider implements IdentityProvider {
  readonly config: IdentityProviderConfig;
  createCalls: CreateSessionInput[] = [];
  checkStatusCalls: CheckStatusInput[] = [];
  getResultCalls: GetResultInput[] = [];
  cancelSessionCalls: CancelSessionInput[] = [];
  resendNotificationCalls: ResendNotificationInput[] = [];

  constructor(private readonly behavior: MockIdentityProviderBehavior = {}) {
    this.config = {
      name: behavior.name ?? 'mock',
      supportsKyc: behavior.supportsKyc ?? true,
      supportsKyb: behavior.supportsKyb ?? true,
      maxLevel: behavior.maxLevel ?? 'advanced',
      options: {},
    };
  }

  createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    this.createCalls.push(input);
    if (this.behavior.createError) {
      return Promise.reject(this.behavior.createError);
    }
    const result =
      typeof this.behavior.createResult === 'function'
        ? this.behavior.createResult(input)
        : (this.behavior.createResult ?? {
            providerSessionId: `mock-${this.config.name}-${this.createCalls.length}`,
            redirectUrl: `https://${this.config.name}.example/session`,
            status: 'pending' as IdentityVerificationStatus,
            provider: this.config.name,
          });
    return Promise.resolve(result);
  }

  checkStatus(input: CheckStatusInput): Promise<VerificationResult> {
    this.checkStatusCalls.push(input);
    if (this.behavior.checkStatusError) {
      return Promise.reject(this.behavior.checkStatusError);
    }
    const result =
      typeof this.behavior.checkStatusResult === 'function'
        ? this.behavior.checkStatusResult(input)
        : (this.behavior.checkStatusResult ?? {
            providerSessionId: input.providerSessionId,
            status: 'pending' as IdentityVerificationStatus,
            level: 'none' as IdentityVerificationLevel,
            verifiedAt: null,
            expiresAt: null,
          });
    return Promise.resolve(result);
  }

  getResult(input: GetResultInput): Promise<VerificationResult> {
    this.getResultCalls.push(input);
    if (this.behavior.getResultError) {
      return Promise.reject(this.behavior.getResultError);
    }
    const result =
      typeof this.behavior.getResultResult === 'function'
        ? this.behavior.getResultResult(input)
        : (this.behavior.getResultResult ?? {
            providerSessionId: input.providerSessionId,
            status: 'approved' as IdentityVerificationStatus,
            level: 'standard' as IdentityVerificationLevel,
            verifiedAt: new Date().toISOString(),
            expiresAt: null,
          });
    return Promise.resolve(result);
  }

  cancelSession(input: CancelSessionInput): Promise<void> {
    this.cancelSessionCalls.push(input);
    return Promise.resolve();
  }

  resendNotification(input: ResendNotificationInput): Promise<void> {
    this.resendNotificationCalls.push(input);
    return Promise.resolve();
  }
}