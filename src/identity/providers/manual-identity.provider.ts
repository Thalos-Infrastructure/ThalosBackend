import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
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
  IdentityProviderError,
} from '../types/identity.types';

/**
 * Manual/Default IdentityProvider.
 *
 * This provider does not call any external vendor. Every session starts as
 * 'pending' and must be advanced through an admin review endpoint. It keeps
 * the identity verification system usable before any real vendor (Persona,
 * Sumsub, Veriff, Onfido, etc.) is wired up behind the same interface.
 *
 * This is the direct replacement for the existing
 * `ManualIdentityProvider` in `src/kyb/providers/`.
 *
 * @module IdentityProvider
 */
@Injectable()
export class ManualIdentityProvider implements IdentityProvider {
  readonly config: IdentityProviderConfig = {
    name: 'manual',
    supportsKyc: true,
    supportsKyb: true,
    maxLevel: 'basic',
    options: {},
  };

  createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    return Promise.resolve({
      providerSessionId: crypto.randomUUID(),
      redirectUrl: null,
      status: 'pending',
      provider: this.config.name,
    });
  }

  checkStatus(_input: CheckStatusInput): Promise<VerificationResult> {
    // The manual provider has no external source of truth; status only changes
    // via the admin review endpoint, which updates our own DB directly.
    return Promise.resolve({
      providerSessionId: _input.providerSessionId,
      status: 'pending',
      level: 'none',
      verifiedAt: null,
      expiresAt: null,
    });
  }

  getResult(input: GetResultInput): Promise<VerificationResult> {
    // Same as checkStatus — no external data to fetch.
    return this.checkStatus({ providerSessionId: input.providerSessionId });
  }

  cancelSession(_input: CancelSessionInput): Promise<void> {
    // No-op: nothing to cancel in the manual flow.
    return Promise.resolve();
  }

  resendNotification(_input: ResendNotificationInput): Promise<void> {
    // No-op: no external notification to resend.
    return Promise.resolve();
  }
}