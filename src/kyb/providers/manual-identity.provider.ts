import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  CreateVerificationSessionInput,
  IdentityProvider,
  KybStatus,
  VerificationSessionResult,
} from './identity-provider.interface';

/**
 * Default IdentityProvider: no external vendor call. Every session starts 'pending' and
 * moves forward only through the admin review endpoint. This keeps KYB usable before any
 * real vendor (Persona, Sumsub, Onfido...) is wired up behind the same interface.
 */
@Injectable()
export class ManualIdentityProvider implements IdentityProvider {
  readonly name = 'manual';

  createVerificationSession(
    _input: CreateVerificationSessionInput,
  ): Promise<VerificationSessionResult> {
    return Promise.resolve({
      providerSessionId: crypto.randomUUID(),
      redirectUrl: null,
      initialStatus: 'pending',
    });
  }

  checkStatus(_providerSessionId: string): Promise<KybStatus> {
    // The manual provider has no external source of truth; status only changes via the
    // admin review endpoint, which updates our own DB directly.
    return Promise.resolve('pending');
  }
}
