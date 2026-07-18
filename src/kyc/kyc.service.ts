import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { IIdentityProvider } from './interfaces/identity-provider.interface';
import { MockKycProvider } from './providers/mock-kyc.provider';
import { KycStatus, KycSession, KycVerificationRow } from './interfaces/kyc.types';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  private readonly provider: IIdentityProvider;

  constructor(
    private readonly supabase: SupabaseService,
    mockProvider: MockKycProvider,
  ) {
    this.provider = mockProvider;
    this.logger.log(`Initialized KYC service with provider: ${this.provider.name}`);
  }

  get activeProvider(): string {
    return this.provider.name;
  }

  async createSession(userId: string, metadata?: Record<string, unknown>) {
    const { providerVerificationId, sessionUrl } = await this.provider.createSession({
      userId,
      metadata,
    });

    const row: Omit<KycVerificationRow, 'id' | 'created_at' | 'updated_at'> = {
      user_id: userId,
      provider: this.provider.name,
      provider_verification_id: providerVerificationId,
      status: KycStatus.Pending,
      metadata: metadata || {},
      verified_at: null,
    };

    const { data, error } = await this.supabase
      .getClient()
      .from('kyc_verifications')
      .insert(row)
      .select()
      .single();

    if (error) {
      this.logger.error(`Failed to persist KYC session: ${error.message}`);
      throw new Error(`Failed to create KYC session: ${error.message}`);
    }

    return {
      session: this.toSession(data as KycVerificationRow),
      sessionUrl,
    };
  }

  async getStatus(userId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('kyc_verifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch KYC status: ${error.message}`);
    }

    if (!data) {
      return { session: null };
    }

    const row = data as KycVerificationRow;
    const providerResult = await this.provider.getStatus(row.provider_verification_id);

    if (providerResult.status !== row.status) {
      const { data: updated } = await this.supabase
        .getClient()
        .from('kyc_verifications')
        .update({
          status: providerResult.status,
          verified_at: providerResult.verifiedAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .select()
        .single();

      if (updated) {
        return { session: this.toSession(updated as KycVerificationRow) };
      }
    }

    return { session: this.toSession(row) };
  }

  async handleWebhook(payload: unknown): Promise<KycSession> {
    const { providerVerificationId, result } = await this.provider.processWebhook(payload);

    const { data, error } = await this.supabase
      .getClient()
      .from('kyc_verifications')
      .update({
        status: result.status,
        verified_at: result.verifiedAt,
        metadata: result.metadata ? { ...result.metadata } : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('provider_verification_id', providerVerificationId)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update KYC session from webhook: ${error?.message}`);
      throw new NotFoundException('KYC session not found');
    }

    this.logger.log(
      `KYC session ${providerVerificationId} updated via webhook to ${result.status}`,
    );
    return this.toSession(data as KycVerificationRow);
  }

  private toSession(row: KycVerificationRow): KycSession {
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerVerificationId: row.provider_verification_id,
      status: row.status,
      metadata: row.metadata || {},
      verifiedAt: row.verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
