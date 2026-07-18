import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { relayToTrustless } from '../internal-trustless/trustless-relay.helper';
import { TW_TO_THALOS_STATUS } from './milestone-sync.constants';
import type { ConflictDetails } from './dto/sync-milestone.dto';
import type { ServiceType } from '../internal-trustless/dto/escrow-write.dto';

@Injectable()
export class MilestoneSyncConflictService {
  private readonly logger = new Logger(MilestoneSyncConflictService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Fetches the live TW escrow state and compares the milestone at
   * milestoneIndex against the expected Thalos status.
   * Returns ConflictDetails if a genuine conflict is detected, null otherwise.
   */
  async detectConflict(
    contractId: string,
    milestoneIndex: number,
    thalosStatus: string,
    serviceType: ServiceType,
  ): Promise<ConflictDetails | null> {
    try {
      const result = await relayToTrustless('GET', `escrow/${serviceType}/get-escrow`, {
        contractId,
      });

      if (result.status >= 400 || !result.data) {
        this.logger.warn(
          `Could not fetch TW escrow for conflict check (contractId=${contractId}): status=${result.status}`,
        );
        return null;
      }

      const escrow = result.data as Record<string, unknown>;
      const milestones = escrow['milestones'] as Array<Record<string, unknown>> | undefined;

      if (!milestones || milestoneIndex >= milestones.length) {
        return null;
      }

      const twMilestone = milestones[milestoneIndex];
      const twRawStatus = twMilestone['status'] as string | undefined;
      if (!twRawStatus) return null;

      const mappedThalosStatus = TW_TO_THALOS_STATUS[twRawStatus];
      if (!mappedThalosStatus) return null;

      // No conflict when statuses agree or TW milestone is still pending (initial state)
      if (mappedThalosStatus === thalosStatus || twRawStatus === 'pending') {
        return null;
      }

      return {
        thalosStatus,
        twStatus: twRawStatus,
        detectedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error(
        `detectConflict failed for contractId=${contractId}, milestone=${milestoneIndex}: ${(err as Error).message}`,
      );
      // Non-blocking: if we can't reach TW, assume no conflict and proceed
      return null;
    }
  }

  async recordConflict(
    agreementId: string,
    milestoneIndex: number,
    details: ConflictDetails,
  ): Promise<void> {
    try {
      await this.supabase.getClient().from('milestone_sync_conflicts').insert({
        agreement_id: agreementId,
        milestone_index: milestoneIndex,
        thalos_status: details.thalosStatus,
        tw_status: details.twStatus,
        detected_at: details.detectedAt,
      });
    } catch (err) {
      this.logger.error(`recordConflict insert failed: ${(err as Error).message}`);
    }
  }
}
