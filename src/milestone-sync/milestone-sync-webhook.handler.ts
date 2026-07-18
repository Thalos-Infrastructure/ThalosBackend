import { Injectable, Logger } from '@nestjs/common';
import { MilestoneSyncService } from './milestone-sync.service';
import { TW_MILESTONE_EVENTS } from './milestone-sync.constants';
import type { TwMilestoneEventDto } from './dto/tw-milestone-event.dto';

@Injectable()
export class MilestoneSyncWebhookHandler {
  private readonly logger = new Logger(MilestoneSyncWebhookHandler.name);

  constructor(private readonly syncService: MilestoneSyncService) {}

  async handle(payload: TwMilestoneEventDto): Promise<{ handled: boolean; reason?: string }> {
    const isMilestoneEvent = (TW_MILESTONE_EVENTS as readonly string[]).includes(payload.event);
    if (!isMilestoneEvent) {
      return { handled: false, reason: 'unhandled_event_type' };
    }

    const milestoneIndex = payload.data?.milestoneIndex;
    if (milestoneIndex === undefined || milestoneIndex === null) {
      this.logger.warn(
        `TW milestone event "${payload.event}" missing milestoneIndex in payload.data`,
      );
      return { handled: false, reason: 'invalid_payload' };
    }

    // Extract TW status from event name (e.g. 'milestone.completed' → 'completed')
    const twStatus = payload.event.split('.')[1];

    try {
      const result = await this.syncService.applyTWMilestoneToThalos(
        payload.contractId,
        milestoneIndex,
        twStatus,
      );

      if (!result.success) {
        this.logger.warn(
          `applyTWMilestoneToThalos failed: contractId=${payload.contractId} milestone=${milestoneIndex} reason=${result.reason}`,
        );
        return { handled: false, reason: result.reason };
      }

      return { handled: true };
    } catch (err) {
      this.logger.error(
        `handle error for event="${payload.event}" contractId="${payload.contractId}": ${(err as Error).message}`,
      );
      return { handled: false, reason: 'internal_error' };
    }
  }
}
