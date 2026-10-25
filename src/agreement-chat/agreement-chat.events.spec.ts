import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import { AgreementChatEvents } from './agreement-chat.events';
import { AgreementChatService } from './agreement-chat.service';

describe('AgreementChatEvents', () => {
  it('writes a funded event when the payload has an agreementId', async () => {
    const appendEvent = jest.fn().mockResolvedValue(undefined);
    const listener = new AgreementChatEvents({ appendEvent } as unknown as AgreementChatService);

    await listener.onFunded({ agreementId: 'agr-1' });

    expect(appendEvent).toHaveBeenCalledWith('agr-1', AGREEMENT_EVENTS.FUNDED, {
      agreementId: 'agr-1',
    });
  });

  it('does not throw when the chat write fails', async () => {
    const appendEvent = jest.fn().mockRejectedValue(new Error('db down'));
    const listener = new AgreementChatEvents({ appendEvent } as unknown as AgreementChatService);

    await expect(
      listener.onDisputeOpened({ agreementId: 'agr-1', reason: 'late' }),
    ).resolves.toBeUndefined();
  });

  it('skips a payload without agreementId', async () => {
    const appendEvent = jest.fn();
    const listener = new AgreementChatEvents({ appendEvent } as unknown as AgreementChatService);

    await listener.onCreated({});

    expect(appendEvent).not.toHaveBeenCalled();
  });
});
