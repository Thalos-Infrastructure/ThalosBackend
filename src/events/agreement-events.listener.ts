import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import {
  AgreementEventName,
  type AgreementEventPayload,
} from "./agreement-events";

/**
 * Throwaway listener used to prove the in-process event bus works end-to-end.
 * It emits a test event on bootstrap and logs whatever it receives.
 * Remove once real domain listeners (e.g. email) are wired up.
 */
@Injectable()
export class AgreementEventsListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgreementEventsListener.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  onApplicationBootstrap(): void {
    const payload: AgreementEventPayload<typeof AgreementEventName.Created> = {
      agreementId: "test-agreement-id",
      title: "Event bus smoke test",
      amount: "100",
      asset: "USDC",
      createdByWallet: "GTESTWALLET",
      participantWallets: ["GTESTWALLET"],
    };

    this.logger.log(
      `Emitting test event "${AgreementEventName.Created}" to verify the event bus`,
    );
    this.eventEmitter.emit(AgreementEventName.Created, payload);
  }

  @OnEvent(AgreementEventName.Created)
  handleAgreementCreated(
    payload: AgreementEventPayload<typeof AgreementEventName.Created>,
  ): void {
    this.logger.log(
      `Received "${AgreementEventName.Created}": ${JSON.stringify(payload)}`,
    );
  }
}
