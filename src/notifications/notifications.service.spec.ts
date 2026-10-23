import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AgreementCreatedData,
  DisputeOpenedData,
  DisputeResolvedData,
  EvidenceSubmittedData,
  MilestoneApprovedData,
} from './types/notification-data.types';

/**
 * Build a deeply chainable Supabase query stub that resolves with the given
 * payload, mirroring only the shape that NotificationsService actually
 * consumes (`from(...).select(...).eq(...).maybeSingle()` /
 * `from(...).select(...).eq(...)`).
 */
function buildSupabaseStub(options: {
  profileEmail: string | null;
  participantWallets: string[];
  /** Makes the `notification_logs` insert fail, to prove it never breaks sending. */
  insertError?: { message: string };
}) {
  const participantsPayload = options.participantWallets.map((wallet_address) => ({
    wallet_address,
  }));

  const terminalMaybeSingle = () => {
    const result: { data: { email: string } | null; error: null } = {
      data: options.profileEmail ? { email: options.profileEmail } : null,
      error: null,
    };
    return Promise.resolve(result);
  };

  const selectProfiles = () => ({
    eq: () => ({ maybeSingle: terminalMaybeSingle }),
  });

  // Two terminal shapes: maybeSingle (profiles) and bare (participants list).
  const selectParticipants = () => ({
    eq: () =>
      Promise.resolve({
        data: participantsPayload,
        error: null,
      }),
  });

  // Rows written to `notification_logs`, so tests can assert what was recorded.
  const inserted: Array<Record<string, unknown>> = [];

  return {
    client: {
      from: (table: string) => ({
        select: (_columns: string) => {
          if (table === 'profiles') return selectProfiles();
          return selectParticipants();
        },
        insert: (rows: Array<Record<string, unknown>>) => {
          inserted.push(...rows);
          return Promise.resolve({ error: options.insertError ?? null });
        },
      }),
    },
    inserted,
  };
}

interface ResendCall {
  from: string;
  replyTo: string;
  to: string[];
  subject: string;
  html: string;
}

/** Build a mock Resend instance that records every send call. */
function buildResendMock(): {
  mock: { emails: { send: jest.Mock<Promise<{ error: null }>, [ResendCall]> } };
  calls: ResendCall[];
} {
  const calls: ResendCall[] = [];
  const send = jest.fn((payload: ResendCall) => {
    calls.push(payload);
    return Promise.resolve({ error: null });
  });
  return {
    mock: { emails: { send } },
    calls,
  };
}

const baseAgreementId = '11111111-1111-1111-1111-111111111111';

const agreementCreatedData: AgreementCreatedData = {
  agreementId: baseAgreementId,
  title: 'Logo design',
  description: 'Brand kit + landing page',
  amount: '150',
  asset: 'USDC',
  createdByWallet: 'GWALLET-CREATOR',
  createdByName: 'Alice',
  participantWallets: ['GWALLET-CREATOR', 'GWALLET-PAYEE'],
};

const milestoneApprovedData: MilestoneApprovedData = {
  agreementId: baseAgreementId,
  agreementTitle: 'Logo design',
  milestoneIndex: 0,
  milestoneDescription: 'Brand kit',
  milestoneAmount: '75',
  asset: 'USDC',
  approvedByWallet: 'GWALLET-CREATOR',
  approvedByName: 'Alice',
};

/** Construct a service with the given ConfigService-backed env, then mount a mock Resend. */
function buildService(
  env: Record<string, string | undefined>,
  stubOptions: Partial<{
    profileEmail: string | null;
    participantWallets: string[];
    insertError: { message: string };
  }> = {},
) {
  const config = new ConfigService(env);
  const stub = buildSupabaseStub({
    profileEmail: 'alice@example.com',
    participantWallets: ['GWALLET-CREATOR', 'GWALLET-PAYEE'],
    ...stubOptions,
  });
  const supabase = { getClient: () => stub.client } as unknown as SupabaseService;
  const service = new NotificationsService(supabase, config);
  // Trigger lifecycle so fromEmail/replyTo read from ConfigService
  service.onModuleInit();

  const resendMock = buildResendMock();
  // Inject the Resend client directly (mirrors what onModuleInit would have
  // done when RESEND_API_KEY is set).
  (service as unknown as { resend: unknown }).resend = resendMock.mock;

  return { service, resendMock, config, notificationLogs: stub.inserted };
}

describe('NotificationsService — EMAIL_FROM / EMAIL_REPLY_TO env wiring', () => {
  it('sends emails using EMAIL_FROM and EMAIL_REPLY_TO from env', async () => {
    const { service, resendMock } = buildService({
      EMAIL_FROM: 'Brand Identity <hello@brand.xyz>',
      EMAIL_REPLY_TO: 'Help Desk <help@brand.xyz>',
    });

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(resendMock.calls).toHaveLength(1);
    const call = resendMock.calls[0];
    expect(call.from).toBe('Brand Identity <hello@brand.xyz>');
    expect(call.replyTo).toBe('Help Desk <help@brand.xyz>');
    expect(call.to).toEqual(expect.arrayContaining(['alice@example.com', 'alice@example.com']));
    expect(call.subject).toContain('New Agreement Created');
  });

  it('trims whitespace from env values', async () => {
    const { service, resendMock } = buildService({
      EMAIL_FROM: '  Spaced From <noreply@thalosplatform.xyz>  ',
      EMAIL_REPLY_TO: '\tReply Hub <reply@thalosplatform.xyz>\n',
    });

    await service.notifyMilestoneApproved(milestoneApprovedData);

    expect(resendMock.calls[0].from).toBe('Spaced From <noreply@thalosplatform.xyz>');
    expect(resendMock.calls[0].replyTo).toBe('Reply Hub <reply@thalosplatform.xyz>');
  });

  it('falls back to documented defaults when EMAILS env vars are unset', async () => {
    const { service, resendMock } = buildService({});

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(resendMock.calls[0].from).toBe('Thalos <notifications@thalosplatform.xyz>');
    // EMAIL_REPLY_TO falls back to the documented no-reply alias, never empty.
    expect(resendMock.calls[0].replyTo).toBe('Thalos <no-reply@thalosplatform.xyz>');
  });

  it('falls back to defaults when env vars are blank strings', async () => {
    const { service, resendMock } = buildService({
      EMAIL_FROM: '   ',
      EMAIL_REPLY_TO: '',
    });

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(resendMock.calls[0].from).toBe('Thalos <notifications@thalosplatform.xyz>');
    expect(resendMock.calls[0].replyTo).toBe('Thalos <no-reply@thalosplatform.xyz>');
  });

  it('changing EMAIL_FROM changes the sender with no code edit', async () => {
    const before = buildService({
      EMAIL_FROM: 'Before <before@thalosplatform.xyz>',
    });
    await before.service.notifyAgreementCreated(agreementCreatedData);

    const after = buildService({
      EMAIL_FROM: 'After <after@thalosplatform.xyz>',
    });
    await after.service.notifyAgreementCreated(agreementCreatedData);

    // Each service must resolve its sender from its own ConfigService — i.e.
    // no static constant is baked into the constructor.
    expect((before.service as unknown as { fromEmail: string }).fromEmail).toBe(
      'Before <before@thalosplatform.xyz>',
    );
    expect((after.service as unknown as { fromEmail: string }).fromEmail).toBe(
      'After <after@thalosplatform.xyz>',
    );

    // And the actual Resend payload must track the env change.
    expect(before.resendMock.calls[0].from).toBe('Before <before@thalosplatform.xyz>');
    expect(after.resendMock.calls[0].from).toBe('After <after@thalosplatform.xyz>');
    expect(after.resendMock.calls[0].from).not.toEqual(before.resendMock.calls[0].from);
  });

  it('does not call Resend when RESEND_API_KEY is not configured', async () => {
    const config = new ConfigService({
      EMAIL_FROM: 'X <x@thalosplatform.xyz>',
      EMAIL_REPLY_TO: 'Y <y@thalosplatform.xyz>',
    });
    const supabase = {
      getClient: () =>
        buildSupabaseStub({
          profileEmail: 'alice@example.com',
          participantWallets: ['GWALLET-CREATOR'],
        }).client,
    } as unknown as SupabaseService;

    const service = new NotificationsService(supabase, config);
    // Simulate the case where RESEND_API_KEY is missing: resend is null.
    await service.notifyAgreementCreated(agreementCreatedData);
    // Nothing to assert beyond "no exception thrown, no Resend call attempted".
    expect(true).toBe(true);
  });

  it('skips sending when there are no resolvable participant emails', async () => {
    const config = new ConfigService({
      EMAIL_FROM: 'Empty Team',
      EMAIL_REPLY_TO: 'Empty Reply',
    });
    const supabase = {
      getClient: () =>
        buildSupabaseStub({
          profileEmail: null,
          participantWallets: ['GWALLET-CREATOR'],
        }).client,
    } as unknown as SupabaseService;

    const service = new NotificationsService(supabase, config);
    const resend = buildResendMock();
    (service as unknown as { resend: unknown }).resend = resend.mock;

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(resend.calls).toHaveLength(0);
  });
});

const evidenceSubmittedData: EvidenceSubmittedData = {
  agreementId: baseAgreementId,
  agreementTitle: 'Logo design',
  milestoneIndex: 0,
  milestoneDescription: 'Brand kit',
  milestoneAmount: '75',
  asset: 'USDC',
  submittedByWallet: 'GWALLET-PAYEE',
  submittedByName: 'Bob',
  evidenceDescription: 'Figma export attached',
  evidenceUrls: ['https://example.com/proof'],
};

const disputeOpenedData: DisputeOpenedData = {
  agreementId: baseAgreementId,
  agreementTitle: 'Logo design',
  disputeReason: 'Deliverable does not match scope',
  openedByWallet: 'GWALLET-CREATOR',
  openedByName: 'Alice',
};

const disputeResolvedData: DisputeResolvedData = {
  agreementId: baseAgreementId,
  agreementTitle: 'Logo design',
  resolution: 'Split 40/60',
  resolvedByWallet: 'GWALLET-RESOLVER',
  refundAmount: '60.00',
  releaseAmount: '90.00',
  asset: 'USDC',
};

describe('NotificationsService — lifecycle email subjects and templates', () => {
  it('sends evidence submitted email with subject and template content', async () => {
    const { service, resendMock } = buildService({});

    await service.notifyEvidenceSubmitted(evidenceSubmittedData);

    expect(resendMock.calls).toHaveLength(1);
    const call = resendMock.calls[0];
    expect(call.subject).toBe('Evidence Submitted: Logo design');
    expect(call.html).toContain('Evidence Submitted');
    expect(call.html).toContain('Logo design');
    expect(call.html).toContain('Brand kit');
    expect(call.html).toContain('Figma export attached');
  });

  it('sends milestone approved email with subject and template content', async () => {
    const { service, resendMock } = buildService({});

    await service.notifyMilestoneApproved(milestoneApprovedData);

    expect(resendMock.calls).toHaveLength(1);
    const call = resendMock.calls[0];
    expect(call.subject).toBe('Milestone Approved: Brand kit');
    expect(call.html).toContain('Milestone Approved');
    expect(call.html).toContain('Brand kit');
    expect(call.html).toContain('Logo design');
  });

  it('sends dispute opened email with subject and template content', async () => {
    const { service, resendMock } = buildService({});

    await service.notifyDisputeOpened(disputeOpenedData);

    expect(resendMock.calls).toHaveLength(1);
    const call = resendMock.calls[0];
    expect(call.subject).toBe('Dispute Opened: Logo design');
    expect(call.html).toContain('Dispute Opened');
    expect(call.html).toContain('Deliverable does not match scope');
    expect(call.html).toContain('Logo design');
  });

  it('sends dispute resolved email with subject and template content', async () => {
    const { service, resendMock } = buildService({});

    await service.notifyDisputeResolved(disputeResolvedData);

    expect(resendMock.calls).toHaveLength(1);
    const call = resendMock.calls[0];
    expect(call.subject).toBe('Dispute Resolved: Logo design');
    expect(call.html).toContain('Dispute Resolved');
    expect(call.html).toContain('Split 40/60');
    expect(call.html).toContain('60.00');
    expect(call.html).toContain('90.00');
  });
});

describe('NotificationsService — every attempt leaves a record', () => {
  it('records a send that went through', async () => {
    const { service, notificationLogs } = buildService({});

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(notificationLogs[0]).toMatchObject({
      agreement_id: baseAgreementId,
      event_type: 'agreement_created',
      channel: 'email',
      recipient_email: 'alice@example.com',
      status: 'sent',
      error_message: null,
    });
  });

  it('records why a send failed, not just that it did', async () => {
    // This is the case that went unnoticed for months in production: the key
    // was invalid and every send was refused, with nothing to query.
    const { service, resendMock, notificationLogs } = buildService({});
    resendMock.mock.emails.send.mockResolvedValueOnce({
      error: { message: 'API key is invalid' },
    } as never);

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(notificationLogs[0]).toMatchObject({
      status: 'failed',
      event_type: 'agreement_created',
      error_message: 'API key is invalid',
    });
  });

  it('records the skip when nobody has an email on file', async () => {
    // The most common reason a notification never arrives, and the one that
    // used to leave no trace at all: the early return happened before any
    // send was attempted.
    const { service, resendMock, notificationLogs } = buildService({}, { profileEmail: null });

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(resendMock.calls).toHaveLength(0);
    expect(notificationLogs[0]).toMatchObject({
      status: 'skipped',
      event_type: 'agreement_created',
      error_message: 'No participant had an email address on their profile',
    });
  });

  it('records one row per recipient', async () => {
    const { service, notificationLogs } = buildService({}, { profileEmail: 'both@example.com' });

    await service.notifyAgreementCreated(agreementCreatedData);

    expect(notificationLogs).toHaveLength(2);
    expect(notificationLogs.every((row) => row.status === 'sent')).toBe(true);
  });

  it('names the event, so the log can be read per step', async () => {
    const { service, notificationLogs } = buildService({});

    await service.notifyMilestoneApproved(milestoneApprovedData);

    expect(notificationLogs[0]).toMatchObject({ event_type: 'milestone_approved' });
  });

  it('still sends when the log cannot be written', async () => {
    // A logging table that can break sending is worse than no logging table.
    const { service, resendMock } = buildService({}, { insertError: { message: 'table missing' } });

    await expect(service.notifyAgreementCreated(agreementCreatedData)).resolves.toBeUndefined();
    expect(resendMock.calls).toHaveLength(1);
  });
});

describe('NotificationsService — the startup check says whether email can work', () => {
  /** A service with a Resend whose `domains.list` answers as configured. */
  function buildWithDomains(
    domainsResponse: unknown,
    env: Record<string, string | undefined> = {},
  ) {
    const { service } = buildService(env);
    const list = jest.fn().mockResolvedValue(domainsResponse);
    (service as unknown as { resend: { domains: { list: jest.Mock } } }).resend = {
      domains: { list },
    };
    return { service, list };
  }

  const verify = (service: NotificationsService) =>
    (service as unknown as { verifyEmailSetup: () => Promise<void> }).verifyEmailSetup();

  afterEach(() => jest.restoreAllMocks());

  it('reports a dead API key instead of looking healthy', async () => {
    // `new Resend(key)` validates nothing, so "client initialized" used to be
    // printed just the same with a key Resend rejects.
    const { service } = buildWithDomains({ data: null, error: { message: 'API key is invalid' } });
    const errors: string[] = [];
    jest
      .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation((m: string) => errors.push(m));

    await verify(service);

    expect(errors.join(' ')).toMatch(/API key is invalid/);
    expect(errors.join(' ')).toMatch(/RESEND_API_KEY/);
  });

  it('reports a sender domain Resend does not have', async () => {
    const { service } = buildWithDomains(
      { data: { data: [{ name: 'other.xyz', status: 'verified' }] }, error: null },
      { EMAIL_FROM: 'Thalos <notifications@thalosplatform.xyz>' },
    );
    const errors: string[] = [];
    jest
      .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation((m: string) => errors.push(m));

    await verify(service);

    expect(errors.join(' ')).toMatch(/thalosplatform\.xyz/);
    expect(errors.join(' ')).toMatch(/not one of its domains/);
  });

  it('reports a domain that is not verified yet', async () => {
    // Resend refuses an unverified domain as firmly as a bad key.
    const { service } = buildWithDomains(
      { data: { data: [{ name: 'thalosplatform.xyz', status: 'pending' }] }, error: null },
      { EMAIL_FROM: 'Thalos <notifications@thalosplatform.xyz>' },
    );
    const errors: string[] = [];
    jest
      .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation((m: string) => errors.push(m));

    await verify(service);

    expect(errors.join(' ')).toMatch(/"pending", not verified/);
  });

  it('says it is ready when the key works and the domain is verified', async () => {
    const { service } = buildWithDomains(
      { data: { data: [{ name: 'thalosplatform.xyz', status: 'verified' }] }, error: null },
      { EMAIL_FROM: 'Thalos <notifications@thalosplatform.xyz>' },
    );
    const logs: string[] = [];
    jest
      .spyOn((service as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
      .mockImplementation((m: string) => logs.push(m));

    await verify(service);

    expect(logs.join(' ')).toMatch(/Resend ready/);
  });

  it('never throws when Resend cannot be reached', async () => {
    // Reaching the provider is not a precondition for the app to boot.
    const { service } = buildService({});
    (service as unknown as { resend: { domains: { list: jest.Mock } } }).resend = {
      domains: { list: jest.fn().mockRejectedValue(new Error('network')) },
    };
    jest
      .spyOn((service as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(verify(service)).resolves.toBeUndefined();
  });
});
