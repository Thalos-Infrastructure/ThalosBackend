import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type ActivityStates = {
  previousState?: string | null;
  newState?: string | null;
};

/**
 * Single shared writer for `agreement_activity` rows.
 * All services must use this instead of private logActivity copies.
 *
 * Supports optional `previous_state` / `new_state` columns introduced by the
 * activity-state logging work so status transitions stay queryable.
 */
@Injectable()
export class AgreementActivityService {
  private readonly logger = new Logger(AgreementActivityService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async logActivity(
    agreementId: string,
    actorWallet: string,
    action: string,
    details: Record<string, unknown> = {},
    states: ActivityStates = {},
  ): Promise<void> {
    try {
      const { error } = await this.supabase.getClient().from('agreement_activity').insert({
        agreement_id: agreementId,
        actor_wallet: actorWallet,
        action,
        details,
        previous_state: states.previousState ?? null,
        new_state: states.newState ?? null,
      });
      if (error) {
        this.logger.error(`logActivity insert failed: ${error.message}`);
      }
    } catch (e) {
      this.logger.error('logActivity', e);
    }
  }
}
