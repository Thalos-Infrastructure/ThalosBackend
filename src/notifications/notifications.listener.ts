import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { NotificationsService } from "./notifications.service";
import { AGREEMENT_EVENTS } from "../common/events/agreement-events.constants";
import {
  AgreementCreatedData,
  AgreementFundedData,
  AgreementCompletedData,
} from "./types/notification-data.types";

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(AGREEMENT_EVENTS.CREATED)
  async handleAgreementCreated(data: AgreementCreatedData): Promise<void> {
    try {
      await this.notifications.notifyAgreementCreated(data);
    } catch (err) {
      this.logger.error("handleAgreementCreated failed", err);
    }
  }

  @OnEvent(AGREEMENT_EVENTS.FUNDED)
  async handleAgreementFunded(data: AgreementFundedData): Promise<void> {
    try {
      await this.notifications.notifyAgreementFunded(data);
    } catch (err) {
      this.logger.error("handleAgreementFunded failed", err);
    }
  }

  @OnEvent(AGREEMENT_EVENTS.COMPLETED)
  async handleAgreementCompleted(data: AgreementCompletedData): Promise<void> {
    try {
      await this.notifications.notifyAgreementCompleted(data);
    } catch (err) {
      this.logger.error("handleAgreementCompleted failed", err);
    }
  }
}
