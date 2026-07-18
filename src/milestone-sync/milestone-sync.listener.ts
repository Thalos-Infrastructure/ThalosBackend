import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MilestoneSyncService } from './milestone-sync.service';
import { AgreementEventName } from '../events/agreement-events';
import type { MilestoneApprovedData } from '../notifications/types/notification-data.types';
import type { MilestoneReleasedPayload } from './dto/sync-milestone.dto';

@Injectable()
export class MilestoneSyncListener {
  private readonly logger = new Logger(MilestoneSyncListener.name);

  constructor(private readonly syncService: MilestoneSyncService) {}

  @OnEvent(AgreementEventName.MilestoneApproved)
  async handleMilestoneApproved(payload: MilestoneApprovedData & { contractId?: string | null; serviceType?: string | null }): Promise<void> {
    if (!payload.contractId) {
      this.logger.log(
        `milestone.approved: agreementId=${payload.agreementId} has no contractId — skipping TW sync`,
      );
      return;
    }

    try {
      const ctx = {
        agreementId: payload.agreementId,
        contractId: payload.contractId,
        milestoneIndex: payload.milestoneIndex,
        thalosStatus: 'approved' as const,
        actorWallet: payload.approvedByWallet,
        serviceType: (payload.serviceType ?? 'multi-release') as 'single-release' | 'multi-release',
        idempotencyKey: MilestoneSyncService.buildIdempotencyKey(
          payload.agreementId,
          payload.milestoneIndex,
          'approved',
        ),
      };
      await this.syncService.pushMilestoneToTW(ctx);
    } catch (err) {
      this.logger.error(`handleMilestoneApproved error: ${(err as Error).message}`);
    }
  }

  @OnEvent('milestone.released')
  async handleMilestoneReleased(payload: MilestoneReleasedPayload): Promise<void> {
    if (!payload.contractId) {
      this.logger.log(
        `milestone.released: agreementId=${payload.agreementId} has no contractId — skipping TW sync`,
      );
      return;
    }

    try {
      const ctx = {
        agreementId: payload.agreementId,
        contractId: payload.contractId,
        milestoneIndex: payload.milestoneIndex,
        thalosStatus: 'released' as const,
        actorWallet: payload.actorWallet,
        evidence: payload.evidence,
        serviceType: (payload.serviceType ?? 'multi-release') as 'single-release' | 'multi-release',
        idempotencyKey: MilestoneSyncService.buildIdempotencyKey(
          payload.agreementId,
          payload.milestoneIndex,
          'released',
        ),
      };
      await this.syncService.pushMilestoneToTW(ctx);
    } catch (err) {
      this.logger.error(`handleMilestoneReleased error: ${(err as Error).message}`);
    }
  }
}
