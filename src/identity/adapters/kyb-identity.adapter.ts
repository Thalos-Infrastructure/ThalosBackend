import { Injectable, Inject } from '@nestjs/common';
import { IDENTITY_PROVIDER } from '../identity.constants';
import { IdentityProvider } from '../interfaces/identity-provider.interface';
import {
  CreateSessionInput,
  CreateSessionResult,
  IdentitySubjectType,
  BusinessEntityType,
} from '../types/identity.types';

/**
 * Adapter that bridges the existing KybService (which uses the old
 * `IdentityProvider` interface from `src/kyb/providers/`) to the new
 * unified `IdentityProvider` interface from `src/identity/`.
 *
 * This adapter translates between the two type systems so that the
 * KYB module can gradually migrate to the new abstraction without
 * breaking existing functionality.
 *
 * ## Migration Path
 *
 * 1. KybService currently depends on `KYB_PROVIDER` (old interface).
 * 2. This adapter wraps the new `IDENTITY_PROVIDER` to expose the old shape.
 * 3. Once all consumers are updated, KybService can switch to injecting
 *    `IDENTITY_PROVIDER` directly and this adapter can be removed.
 *
 * @module IdentityProvider
 */
@Injectable()
export class KybIdentityAdapter {
  constructor(
    @Inject(IDENTITY_PROVIDER)
    private readonly provider: IdentityProvider,
  ) {}

  /**
   * Adapt the old `createVerificationSession` call to the new interface.
   */
  async createVerificationSession(input: {
    organizationId: string;
    businessName: string;
    registrationNumber: string;
    country: string;
    entityType: string;
  }): Promise<{
    providerSessionId: string;
    redirectUrl: string | null;
    initialStatus: string;
  }> {
    const sessionInput: CreateSessionInput = {
      externalRef: input.organizationId,
      subjectType: 'business',
      business: {
        legalName: input.businessName,
        registrationNumber: input.registrationNumber,
        countryOfRegistration: input.country,
        businessType: this.mapEntityType(input.entityType),
        documents: [],
      },
      metadata: {
        organizationId: input.organizationId,
        entityType: input.entityType,
      },
    };

    const result: CreateSessionResult = await this.provider.createSession(sessionInput);

    return {
      providerSessionId: result.providerSessionId,
      redirectUrl: result.redirectUrl,
      initialStatus: this.mapStatus(result.status),
    };
  }

  /**
   * Adapt the old `checkStatus` call to the new interface.
   */
  async checkStatus(providerSessionId: string): Promise<string> {
    const result = await this.provider.checkStatus({ providerSessionId });
    return this.mapStatus(result.status);
  }

  private mapEntityType(entityType: string): BusinessEntityType {
    const mapping: Record<string, BusinessEntityType> = {
      company: 'corporation',
      startup: 'llc',
      organization: 'non_profit',
      legal_entity: 'other',
    };
    return mapping[entityType] ?? 'other';
  }

  private mapStatus(status: string): string {
    const mapping: Record<string, string> = {
      not_started: 'pending',
      pending: 'pending',
      in_review: 'in_review',
      approved: 'verified',
      declined: 'rejected',
      expired: 'rejected',
      abandoned: 'rejected',
      error: 'rejected',
    };
    return mapping[status] ?? 'pending';
  }
}