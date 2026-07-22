import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseService } from '../supabase/supabase.service';
import { KYB_REJECTED, KYB_VERIFIED } from '../common/constants/kyb-events';
import { CreateKybSessionDto, ReviewKybSessionDto } from './dto/kyb.dto';
import {
  IdentityProvider,
  KYB_PROVIDER,
  KybEntityType,
  KybStatus,
} from './providers/identity-provider.interface';

export interface KybVerification {
  id: string;
  organization_id: string;
  requested_by: string;
  entity_type: KybEntityType;
  business_name: string;
  registration_number: string;
  country: string;
  status: KybStatus;
  provider: string;
  provider_session_id: string;
  rejection_reason: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

const FINALIZED_STATUSES: KybStatus[] = ['verified', 'rejected'];

@Injectable()
export class KybService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(KYB_PROVIDER) private readonly provider: IdentityProvider,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async isAdmin(userId: string): Promise<boolean> {
    const { data: authUser } = await this.supabase
      .getClient()
      .from('auth_users')
      .select('wallet_public_key')
      .eq('id', userId)
      .maybeSingle();

    const wallet = (authUser as { wallet_public_key?: string } | null)?.wallet_public_key;
    if (!wallet) return false;

    const { data: profile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('role')
      .eq('wallet_address', wallet)
      .maybeSingle();

    return (profile as { role?: string } | null)?.role === 'admin';
  }

  private async findByOrganizationId(organizationId: string): Promise<KybVerification | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('kyb_verifications')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data as KybVerification) ?? null;
  }

  async createSession(
    userId: string,
    dto: CreateKybSessionDto,
  ): Promise<{ verification: KybVerification }> {
    const existing = await this.findByOrganizationId(dto.organization_id);

    if (existing) {
      if (existing.requested_by !== userId) {
        throw new ForbiddenException('Not the requester for this organization');
      }

      if (existing.status === 'pending' || existing.status === 'in_review') {
        // Already has a live session in flight; don't spawn a duplicate with the provider.
        return { verification: existing };
      }

      if (existing.status === 'verified') {
        return { verification: existing };
      }

      // status === 'rejected': allow a fresh attempt.
      const session = await this.provider.createVerificationSession({
        organizationId: dto.organization_id,
        businessName: dto.business_name,
        registrationNumber: dto.registration_number,
        country: dto.country,
        entityType: dto.entity_type,
      });

      const { data, error } = await this.supabase
        .getClient()
        .from('kyb_verifications')
        .update({
          entity_type: dto.entity_type,
          business_name: dto.business_name,
          registration_number: dto.registration_number,
          country: dto.country,
          status: session.initialStatus,
          provider: this.provider.name,
          provider_session_id: session.providerSessionId,
          rejection_reason: null,
          verified_at: session.initialStatus === 'verified' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', dto.organization_id)
        .select()
        .single();

      if (error) {
        throw new BadRequestException(error.message);
      }
      return { verification: data as KybVerification };
    }

    const session = await this.provider.createVerificationSession({
      organizationId: dto.organization_id,
      businessName: dto.business_name,
      registrationNumber: dto.registration_number,
      country: dto.country,
      entityType: dto.entity_type,
    });

    const { data, error } = await this.supabase
      .getClient()
      .from('kyb_verifications')
      .insert({
        organization_id: dto.organization_id,
        requested_by: userId,
        entity_type: dto.entity_type,
        business_name: dto.business_name,
        registration_number: dto.registration_number,
        country: dto.country,
        status: session.initialStatus,
        provider: this.provider.name,
        provider_session_id: session.providerSessionId,
        verified_at: session.initialStatus === 'verified' ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation: another request won the race and inserted this
      // organization_id first. Treat it like the "already exists" branch above
      // instead of surfacing a raw DB error for a legitimate concurrent request.
      if ((error as { code?: string }).code === '23505') {
        const raced = await this.findByOrganizationId(dto.organization_id);
        if (raced) {
          return { verification: raced };
        }
      }
      throw new BadRequestException(error.message);
    }

    return { verification: data as KybVerification };
  }

  async getStatus(
    userId: string,
    organizationId: string,
  ): Promise<{ verification: KybVerification }> {
    const verification = await this.findByOrganizationId(organizationId);
    if (!verification) {
      throw new NotFoundException('No KYB verification found for this organization');
    }

    if (verification.requested_by !== userId && !(await this.isAdmin(userId))) {
      throw new ForbiddenException('Not authorized to view this KYB verification');
    }

    return { verification };
  }

  async review(
    userId: string,
    organizationId: string,
    dto: ReviewKybSessionDto,
  ): Promise<{ verification: KybVerification }> {
    if (!(await this.isAdmin(userId))) {
      throw new ForbiddenException('Only admins can review KYB verifications');
    }

    const existing = await this.findByOrganizationId(organizationId);
    if (!existing) {
      throw new NotFoundException('No KYB verification found for this organization');
    }

    if (FINALIZED_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        `Cannot review a verification already finalized as "${existing.status}"`,
      );
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('kyb_verifications')
      .update({
        status: dto.status,
        rejection_reason: dto.status === 'rejected' ? dto.rejection_reason : null,
        verified_at: dto.status === 'verified' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }

    const verification = data as KybVerification;

    if (verification.status === 'verified') {
      this.eventEmitter.emit(KYB_VERIFIED, {
        organizationId: verification.organization_id,
        businessName: verification.business_name,
        verifiedAt: verification.verified_at,
      });
    } else if (verification.status === 'rejected') {
      this.eventEmitter.emit(KYB_REJECTED, {
        organizationId: verification.organization_id,
        businessName: verification.business_name,
        rejectionReason: verification.rejection_reason,
      });
    }

    return { verification };
  }

  /** Used by other modules (e.g. future Enterprise Agreements) to gate on KYB status. */
  async isVerified(organizationId: string): Promise<boolean> {
    const verification = await this.findByOrganizationId(organizationId);
    return verification?.status === 'verified';
  }
}
