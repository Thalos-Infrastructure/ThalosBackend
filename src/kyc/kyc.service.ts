import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SupabaseService } from '../supabase/supabase.service';
import { IdentityProvidersService } from '../identity-providers/identity-providers.service';
import { CreateKycSessionDto } from './dto/kyc.dto';

export type KycStatus = 'pending' | 'in_review' | 'verified' | 'rejected' | 'expired';

export interface KycVerification {
  id: string;
  user_id: string;
  status: KycStatus;
  provider: string;
  provider_session_id: string;
  rejection_reason: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WebhookResult {
  providerVerificationId: string;
  result: {
    status: KycStatus;
    verifiedAt: string | null;
  };
}

@Injectable()
export class KycService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly identityProvidersService: IdentityProvidersService,
  ) {}

  private async findByUserId(userId: string): Promise<KycVerification | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('kyc_verifications')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(error.message);
    }
    return (data as KycVerification) ?? null;
  }

  async createSession(
    userId: string,
    dto: CreateKycSessionDto,
  ): Promise<{ verification: KycVerification; sessionUrl?: string }> {
    const existing = await this.findByUserId(userId);

    if (existing) {
      if (existing.status === 'pending' || existing.status === 'in_review') {
        // Already has a live session in flight
        return { verification: existing };
      }

      if (existing.status === 'verified') {
        return { verification: existing };
      }

      // If rejected or expired, we create a new session
      const session = await this.identityProvidersService.createSession(userId, dto.metadata);

      // IdentityProvidersService gets the provider implicitly via KYC_PROVIDER,
      // but IdentityProvidersService doesn't expose `provider.name` directly.
      // We will look up the provider config name. Actually, we can fetch the provider name
      // by relying on the environment variable, but it's cleaner to ask IdentityProvidersService
      // Unfortunately IdentityProvidersService doesn't expose it. Let's just use 'default' for now
      // or we can read the env variable inside IdentityProvidersService.
      // We can get the provider name from process.env.IDENTITY_PROVIDER ?? 'sumsub'.
      const providerName = process.env.IDENTITY_PROVIDER ?? 'sumsub';

      const { data, error } = await this.supabase
        .getClient()
        .from('kyc_verifications')
        .update({
          status: 'pending',
          provider: providerName,
          provider_session_id: session.providerVerificationId,
          rejection_reason: null,
          verified_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        throw new BadRequestException(error.message);
      }
      return { verification: data as KycVerification, sessionUrl: session.sessionUrl };
    }

    const session = await this.identityProvidersService.createSession(userId, dto.metadata);
    const providerName = process.env.IDENTITY_PROVIDER ?? 'sumsub';

    const { data, error } = await this.supabase
      .getClient()
      .from('kyc_verifications')
      .insert({
        user_id: userId,
        status: 'pending',
        provider: providerName,
        provider_session_id: session.providerVerificationId,
        verified_at: null,
      })
      .select()
      .single();

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        const raced = await this.findByUserId(userId);
        if (raced) {
          return { verification: raced };
        }
      }
      throw new BadRequestException(error.message);
    }

    return { verification: data as KycVerification, sessionUrl: session.sessionUrl };
  }

  async getStatus(userId: string): Promise<{ verification: KycVerification }> {
    const verification = await this.findByUserId(userId);
    if (!verification) {
      throw new NotFoundException('No KYC verification found for this user');
    }

    // Sync status with provider if pending/in_review
    if (verification.status === 'pending' || verification.status === 'in_review') {
      const providerStatus = await this.identityProvidersService.getStatus(
        verification.provider_session_id,
      );

      if (providerStatus.status !== verification.status) {
        const { data, error } = await this.supabase
          .getClient()
          .from('kyc_verifications')
          .update({
            status: providerStatus.status,
            verified_at:
              providerStatus.status === 'verified'
                ? (providerStatus.verifiedAt ?? new Date().toISOString())
                : null,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .select()
          .single();

        if (error) {
          throw new BadRequestException(error.message);
        }
        return { verification: data as KycVerification };
      }
    }

    return { verification };
  }

  @OnEvent('kyc.webhook.processed')
  async handleWebhookProcessed(payload: WebhookResult) {
    const { providerVerificationId, result } = payload;
    
    const { data, error } = await this.supabase
      .getClient()
      .from('kyc_verifications')
      .update({
        status: result.status,
        verified_at: result.status === 'verified' ? (result.verifiedAt ?? new Date().toISOString()) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('provider_session_id', providerVerificationId)
      .select();
      
    if (error) {
      console.error(`Failed to update KYC status from webhook: ${error.message}`);
    } else if (!data || data.length === 0) {
      console.warn(`Webhook processed for unknown provider session: ${providerVerificationId}`);
    }
  }
}
