import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SupabaseService } from '../supabase/supabase.service';
import {
  KYC_PROVIDER,
  IKycProvider,
} from '../identity-providers/interfaces/kyc-provider.interface';
import { VerificationService } from '../verification/verification.service';
import { VerificationStatusResponse } from '../verification/verification.types';
import { CreateKycSessionDto } from './dto/kyc.dto';

interface WebhookResult {
  providerVerificationId: string;
  result: {
    status: string;
    verifiedAt: string | null;
  };
}

@Injectable()
export class KycService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(KYC_PROVIDER) private readonly provider: IKycProvider,
    private readonly verificationService: VerificationService,
  ) {}

  async createSession(
    userId: string,
    dto: CreateKycSessionDto,
  ): Promise<{ verification: VerificationStatusResponse; sessionUrl?: string }> {
    const status = await this.verificationService.getUserVerification(userId, {
      isInternalService: true,
    });

    if (status.status === 'pending' || status.status === 'in_review') {
      return { verification: status };
    }

    if (status.status === 'verified') {
      return { verification: status };
    }

    const session = await this.provider.createSession({ userId, metadata: dto.metadata });

    const metadata = {
      ...(dto.metadata || {}),
      ...(session.metadata || {}),
      ...(session.sessionUrl ? { sessionUrl: session.sessionUrl } : {}),
    };

    const { error } = await this.supabase.getClient().from('verifications').upsert(
      {
        subject_type: 'user',
        subject_id: userId,
        provider: this.provider.name,
        provider_reference: session.providerVerificationId,
        status: 'pending',
        metadata,
        verified_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'subject_type,subject_id,provider' },
    );

    if (error) {
      throw new BadRequestException(error.message);
    }

    const updatedStatus = await this.verificationService.getUserVerification(userId, {
      isInternalService: true,
    });
    return { verification: updatedStatus, sessionUrl: session.sessionUrl };
  }

  async getStatus(userId: string): Promise<{ verification: VerificationStatusResponse }> {
    const status = await this.verificationService.getUserVerification(userId, {
      isInternalService: true,
    });

    // Optional: we could do JIT sync here if it's pending/in_review, but typically we rely on webhooks.
    // In the old code, we checked the provider status if it was pending/in_review.
    // If the reviewer said "thin-wrap the Verification service", maybe we can just return the status.
    // Let's implement JIT sync for the current provider if the aggregate status is pending.

    if (status.status === 'pending' || status.status === 'in_review') {
      // Find the specific pending record for this provider to sync
      const { data } = await this.supabase
        .getClient()
        .from('verifications')
        .select('*')
        .eq('subject_type', 'user')
        .eq('subject_id', userId)
        .eq('provider', this.provider.name)
        .maybeSingle();

      if (
        data &&
        data.provider_reference &&
        (data.status === 'pending' || data.status === 'in_review')
      ) {
        const providerStatus = await this.provider.getStatus(data.provider_reference);

        if (String(providerStatus.status) !== String(data.status)) {
          await this.supabase
            .getClient()
            .from('verifications')
            .update({
              status: providerStatus.status,
              verified_at:
                String(providerStatus.status) === 'verified'
                  ? (providerStatus.verifiedAt ?? new Date().toISOString())
                  : null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', data.id);

          const updatedStatus = await this.verificationService.getUserVerification(userId, {
            isInternalService: true,
          });
          return { verification: updatedStatus };
        }
      }
    }

    return { verification: status };
  }

  @OnEvent('kyc.webhook.processed')
  async handleWebhookProcessed(payload: WebhookResult) {
    const { providerVerificationId, result } = payload;

    const { data, error } = await this.supabase
      .getClient()
      .from('verifications')
      .update({
        status: result.status,
        verified_at:
          String(result.status) === 'verified'
            ? (result.verifiedAt ?? new Date().toISOString())
            : null,
        updated_at: new Date().toISOString(),
      })
      .eq('provider_reference', providerVerificationId)
      .select();

    if (error) {
      console.error(`Failed to update KYC status from webhook: ${error.message}`);
    } else if (!data || data.length === 0) {
      console.warn(`Webhook processed for unknown provider session: ${providerVerificationId}`);
    }
  }
}
