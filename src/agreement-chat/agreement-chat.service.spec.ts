import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AgreementChatService, SYSTEM_SENDER_WALLET } from './agreement-chat.service';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import { FilesService } from '../files/files.service';
import { SupabaseService } from '../supabase/supabase.service';

const AGREEMENT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const WALLET = 'GWALLET00000000000000000000000000000000000000000000000000';

function buildChat(options: { isParticipant?: boolean } = {}) {
  const { isParticipant = true } = options;
  const inserted: Array<Record<string, unknown>> = [];

  const client = {
    from: (table: string) => {
      if (table === 'agreements') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: AGREEMENT, created_by: 'GCREATOR' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'user_wallets') {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [{ wallet_address: WALLET, is_primary: true }],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'auth_users') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          }),
        };
      }
      if (table === 'agreement_participants') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                limit: () =>
                  Promise.resolve({
                    data: isParticipant ? [{ wallet_address: WALLET }] : [],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === 'agreement_messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: 'm1', created_at: '2026-10-25T00:00:00Z', ...row },
                    error: null,
                  }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              is: () => Promise.resolve({ data: [], error: null }),
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'own',
                      agreement_id: AGREEMENT,
                      sender_wallet: WALLET,
                      message: 'mine',
                      created_at: '2026-10-25T00:00:00Z',
                      read_at: null,
                      kind: 'user',
                      event_type: null,
                      metadata: {},
                    },
                    {
                      id: 'theirs',
                      agreement_id: AGREEMENT,
                      sender_wallet: 'GOTHER',
                      message: 'hello',
                      created_at: '2026-10-25T00:00:01Z',
                      read_at: null,
                      kind: 'user',
                      event_type: null,
                      metadata: {},
                    },
                    {
                      id: 'evt',
                      agreement_id: AGREEMENT,
                      sender_wallet: SYSTEM_SENDER_WALLET,
                      message: 'Dispute opened',
                      created_at: '2026-10-25T00:00:02Z',
                      read_at: null,
                      kind: 'event',
                      event_type: 'dispute.opened',
                      metadata: {},
                    },
                  ],
                  error: null,
                }),
            }),
          }),
          update: () => ({
            in: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === 'agreement_message_attachments') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      return {};
    },
  };

  const files = {
    readableFiles: () => Promise.resolve([]),
  } as unknown as FilesService;

  const service = new AgreementChatService(
    { getClient: () => client } as unknown as SupabaseService,
    files,
  );

  return { service, inserted };
}

describe('AgreementChatService — user messages', () => {
  it('stores a participant message as kind=user', async () => {
    const { service, inserted } = buildChat();

    await service.sendMessage(USER, {
      agreement_id: AGREEMENT,
      sender_wallet: WALLET,
      message: 'hello',
    });

    expect(inserted[0]).toMatchObject({
      kind: 'user',
      event_type: null,
      message: 'hello',
      sender_id: USER,
    });
  });

  it('refuses an empty message without attachments', async () => {
    const { service } = buildChat();

    await expect(
      service.sendMessage(USER, {
        agreement_id: AGREEMENT,
        sender_wallet: WALLET,
        message: '   ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a sender who is not in the agreement', async () => {
    const { service } = buildChat({ isParticipant: false });

    await expect(
      service.sendMessage(USER, {
        agreement_id: AGREEMENT,
        sender_wallet: WALLET,
        message: 'hello',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('AgreementChatService — read receipts', () => {
  it('does not treat the reader as unread on their own messages', async () => {
    const { service } = buildChat();
    await expect(service.markRead(USER, AGREEMENT)).resolves.toMatchObject({ marked: 0 });
  });

  it('counts only the other party’s unread user messages', async () => {
    const { service } = buildChat();
    const result = await service.getMessages(USER, AGREEMENT);
    expect(result.unread_count).toBe(1);
    expect(result.messages).toHaveLength(3);
  });
});

describe('AgreementChatService — lifecycle events', () => {
  it('writes an event line that a user cannot send', async () => {
    const { service, inserted } = buildChat();

    await service.appendEvent(AGREEMENT, AGREEMENT_EVENTS.FUNDED, { agreementId: AGREEMENT });

    expect(inserted[0]).toMatchObject({
      kind: 'event',
      event_type: AGREEMENT_EVENTS.FUNDED,
      sender_wallet: SYSTEM_SENDER_WALLET,
      sender_id: null,
      message: 'Escrow funded',
    });
  });

  it('puts the proposed split on the timeline line', async () => {
    const { service, inserted } = buildChat();

    await service.appendEvent(AGREEMENT, AGREEMENT_EVENTS.DISPUTE_PROPOSAL, {
      agreementId: AGREEMENT,
      payerPercentage: 40,
      payeePercentage: 60,
    });

    expect(inserted[0]).toMatchObject({
      kind: 'event',
      event_type: AGREEMENT_EVENTS.DISPUTE_PROPOSAL,
      message: 'Settlement proposed (40% payer / 60% payee)',
    });
  });
});
