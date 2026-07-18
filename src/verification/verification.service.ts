import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { VerificationProviderFactory } from '../verification/providers/provider-factory';
import {
  CreateVerificationSessionDto,
  ProviderWebhookPayload,
  VerificationProvider,
  VerificationSession,
  VerificationStatus,
  VerificationType,
} from '../verification/dto/verification.dto';

@Injectable()
export class VerificationService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
    private readonly providerFactory: VerificationProviderFactory,
  ) {}

  async createSession(
    userId: string,
    walletAddress: string,
    dto: CreateVerificationSessionDto,
  ): Promise<{ session: VerificationSession | null; error: string | null }> {
    if (!dto.type) {
      throw new BadRequestException('Verification type (kyc or kyb) is required');
    }

    const provider = dto.provider ?? this.providerFactory.getDefaultProviderName();
    const providerInstance = this.providerFactory.getProvider({ provider });

    if (!providerInstance.supportedTypes.includes(dto.type)) {
      throw new BadRequestException(
        `Provider ${provider} does not support ${dto.type} verifications`,
      );
    }

    try {
      const providerResponse = await providerInstance.createSession(dto.subject, dto.type);

      const expiresAt = new Date(providerResponse.expires_at);
      const now = new Date().toISOString();

      const { data: session, error: insertError } = await this.supabase
        .getClient()
        .from('verification_sessions')
        .insert({
          user_id: userId,
          wallet_address: walletAddress,
          type: dto.type,
          provider,
          status: VerificationStatus.PENDING,
          provider_session_id: providerResponse.provider_session_id,
          provider_url: providerResponse.provider_url,
          subject: dto.subject,
          expires_at: expiresAt.toISOString(),
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (insertError) {
        return {
          session: null,
          error: `Failed to create verification session: ${insertError.message}`,
        };
      }

      return { session: session as VerificationSession, error: null };
    } catch (err) {
      return {
        session: null,
        error: err instanceof Error ? err.message : 'Unknown provider error',
      };
    }
  }

  async getSession(
    userId: string,
    sessionId: string,
  ): Promise<{ session: VerificationSession | null; error: string | null }> {
    const { data: session, error: fetchError } = await this.supabase
      .getClient()
      .from('verification_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError || !session) {
      return { session: null, error: 'Verification session not found' };
    }

    const existingSession = session as VerificationSession;

    // Handle expired sessions
    if (existingSession.expires_at && new Date(existingSession.expires_at) < new Date()) {
      if (existingSession.status === VerificationStatus.PENDING) {
        await this.supabase
          .getClient()
          .from('verification_sessions')
          .update({ status: VerificationStatus.EXPIRED, updated_at: new Date().toISOString() })
          .eq('id', sessionId);

        existingSession.status = VerificationStatus.EXPIRED;
      }
    }

    // Check status from provider if still pending
    if (existingSession.status === VerificationStatus.PENDING) {
      // Ensure we have a provider session ID before checking status
      if (!existingSession.provider_session_id) {
        // This shouldn't happen for valid sessions, but handle gracefully
        await this.supabase
          .getClient()
          .from('verification_sessions')
          .update({
            status: VerificationStatus.FAILED,
            error: { code: 'MISSING_PROVIDER_SESSION', message: 'Provider session ID not found' },
            updated_at: new Date().toISOString(),
          })
          .eq('id', sessionId);

        existingSession.status = VerificationStatus.FAILED;
        existingSession.error = {
          code: 'MISSING_PROVIDER_SESSION',
          message: 'Provider session ID not found',
        };
      } else {
        const provider = this.providerFactory.getProvider({
          provider: existingSession.provider,
        });

        try {
          const providerStatus = await provider.getStatus(existingSession.provider_session_id);
          const updates: Record<string, unknown> = {
            status: providerStatus.status,
            updated_at: new Date().toISOString(),
          };

          if (providerStatus.result) {
            updates.result = providerStatus.result;
          }

          if (providerStatus.error) {
            updates.error = providerStatus.error;
          }

          if (providerStatus.status === VerificationStatus.COMPLETED) {
            updates.completed_at = new Date().toISOString();
          }

          await this.supabase
            .getClient()
            .from('verification_sessions')
            .update(updates)
            .eq('id', sessionId);

          Object.assign(existingSession, updates);
        } catch (err) {
          await this.supabase
            .getClient()
            .from('verification_sessions')
            .update({
              status: VerificationStatus.FAILED,
              error: {
                code: 'PROVIDER_ERROR',
                message: err instanceof Error ? err.message : 'Unknown error',
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId);

          existingSession.status = VerificationStatus.FAILED;
          existingSession.error = {
            code: 'PROVIDER_ERROR',
            message: err instanceof Error ? err.message : 'Unknown error',
          };
        }
      }
    }

    return { session: existingSession, error: null };
  }

  async getSessionsByUser(
    userId: string,
    type?: VerificationType,
  ): Promise<{ sessions: VerificationSession[]; error: string | null }> {
    let query = this.supabase
      .getClient()
      .from('verification_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (type) {
      query = query.eq('type', type);
    }

    const { data: sessions, error: fetchError } = await query;

    if (fetchError) {
      return { sessions: [], error: fetchError.message };
    }

    return { sessions: (sessions as VerificationSession[]) || [], error: null };
  }

  /**
   * Retrieve Verification Results.
   *
   * Fetches the normalized verification outcome from the provider and persists
   * it against the local session. Falls back to the stored result when the
   * provider does not expose a dedicated results endpoint.
   */
  async getResults(
    userId: string,
    sessionId: string,
  ): Promise<{ session: VerificationSession | null; error: string | null }> {
    const { data: session, error: fetchError } = await this.supabase
      .getClient()
      .from('verification_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError || !session) {
      return { session: null, error: 'Verification session not found' };
    }

    const existingSession = session as VerificationSession;

    if (!existingSession.provider_session_id) {
      return { session: existingSession, error: null };
    }

    const provider = this.providerFactory.getProvider({ provider: existingSession.provider });

    // Provider does not support a dedicated results operation: return stored data.
    if (typeof provider.getResults !== 'function') {
      return { session: existingSession, error: null };
    }

    try {
      const providerResult = await provider.getResults(existingSession.provider_session_id);

      const updates: Record<string, unknown> = {
        status: providerResult.status,
        updated_at: new Date().toISOString(),
      };

      if (providerResult.result) {
        updates.result = providerResult.result;
      }
      if (providerResult.error) {
        updates.error = providerResult.error;
      }
      if (providerResult.status === VerificationStatus.COMPLETED) {
        updates.completed_at = providerResult.completed_at ?? new Date().toISOString();
      }

      await this.supabase
        .getClient()
        .from('verification_sessions')
        .update(updates)
        .eq('id', sessionId);

      Object.assign(existingSession, updates);

      return { session: existingSession, error: null };
    } catch (err) {
      return {
        session: existingSession,
        error: err instanceof Error ? err.message : 'Failed to retrieve verification results',
      };
    }
  }

  /**
   * Cancel Verification.
   *
   * Requests cancellation from the provider (when supported) and marks the
   * local session as cancelled. Terminal sessions cannot be cancelled.
   */
  async cancelSession(
    userId: string,
    sessionId: string,
  ): Promise<{ session: VerificationSession | null; error: string | null }> {
    const { data: session, error: fetchError } = await this.supabase
      .getClient()
      .from('verification_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError || !session) {
      return { session: null, error: 'Verification session not found' };
    }

    const existingSession = session as VerificationSession;

    const terminalStatuses: VerificationStatus[] = [
      VerificationStatus.COMPLETED,
      VerificationStatus.FAILED,
      VerificationStatus.EXPIRED,
      VerificationStatus.CANCELLED,
    ];

    if (terminalStatuses.includes(existingSession.status)) {
      return {
        session: existingSession,
        error: `Cannot cancel a session in "${existingSession.status}" state`,
      };
    }

    const provider = this.providerFactory.getProvider({ provider: existingSession.provider });

    try {
      // Best-effort provider-side cancellation when supported.
      if (existingSession.provider_session_id && typeof provider.cancelSession === 'function') {
        await provider.cancelSession(existingSession.provider_session_id);
      }

      const now = new Date().toISOString();
      const updates = {
        status: VerificationStatus.CANCELLED,
        cancelled_at: now,
        updated_at: now,
      };

      await this.supabase
        .getClient()
        .from('verification_sessions')
        .update(updates)
        .eq('id', sessionId);

      Object.assign(existingSession, updates);

      return { session: existingSession, error: null };
    } catch (err) {
      return {
        session: existingSession,
        error: err instanceof Error ? err.message : 'Failed to cancel verification session',
      };
    }
  }

  async handleWebhook(
    provider: VerificationProvider,
    payload: ProviderWebhookPayload,
  ): Promise<{ handled: boolean; error: string | null }> {
    const providerInstance = this.providerFactory.getProvider({ provider });

    try {
      const providerStatus = await providerInstance.handleWebhook(payload);

      const { data: session, error: fetchError } = await this.supabase
        .getClient()
        .from('verification_sessions')
        .select('id, status')
        .eq('provider_session_id', payload.session_id)
        .eq('provider', provider)
        .maybeSingle();

      if (fetchError || !session) {
        return { handled: false, error: 'Session not found for provider session' };
      }

      const updates: Record<string, unknown> = {
        status: providerStatus.status,
        updated_at: new Date().toISOString(),
      };

      if (providerStatus.result) {
        updates.result = providerStatus.result;
      }

      if (providerStatus.error) {
        updates.error = providerStatus.error;
      }

      if (providerStatus.status === VerificationStatus.COMPLETED) {
        updates.completed_at = new Date().toISOString();
      }

      await this.supabase
        .getClient()
        .from('verification_sessions')
        .update(updates)
        .eq('id', (session as { id: string }).id);

      return { handled: true, error: null };
    } catch (err) {
      return {
        handled: false,
        error: err instanceof Error ? err.message : 'Webhook handling failed',
      };
    }
  }

  getSupportedProviders(): VerificationProvider[] {
    return this.providerFactory.getSupportedProviders();
  }
}
