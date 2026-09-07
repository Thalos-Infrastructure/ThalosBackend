import { BadRequestException } from '@nestjs/common';
import { KycService, KycVerificationRecord } from './kyc.service';
import { CreateKycSessionDto } from './dto/kyc.dto';
import type { SessionResult } from '../identity-providers/interfaces/kyc-provider.interface';

// ---------------------------------------------------------------------------
// Chainable Supabase mock: every non-terminal method returns itself, and
// maybeSingle()/single() resolve to the configured { data, error }.
// ---------------------------------------------------------------------------
function chainMock(data: unknown, error: unknown = null) {
  const obj: Record<string, jest.Mock> = {};
  ['from', 'select', 'eq', 'insert', 'update', 'neq'].forEach((m) => {
    obj[m] = jest.fn().mockReturnValue(obj);
  });
  obj.maybeSingle = jest.fn().mockResolvedValue({ data, error });
  obj.single = jest.fn().mockResolvedValue({ data, error });
  return obj;
}

interface BuildOpts {
  getClientCalls?: Array<unknown>;
  providerSession?: Partial<SessionResult>;
  providerName?: string;
}

function buildService(opts: BuildOpts = {}) {
  const calls = opts.getClientCalls ?? [];
  let callIndex = 0;
  const getClient = jest.fn().mockImplementation(() => calls[callIndex++]);
  const supabase = { getClient };

  const provider = {
    name: opts.providerName ?? 'sumsub',
    createSession: jest.fn().mockResolvedValue({
      providerVerificationId: 'sess-123',
      sessionUrl: 'https://example.com/session',
      metadata: { status: 'pending' },
      ...opts.providerSession,
    }),
    getStatus: jest.fn(),
    processWebhook: jest.fn(),
  };

  const svc = new (KycService as unknown as new (...args: unknown[]) => KycService)(
    supabase,
    provider,
  );

  return { svc, provider, getClient };
}

const baseDto: CreateKycSessionDto = {};

function record(overrides: Partial<KycVerificationRecord> = {}): KycVerificationRecord {
  return {
    id: 'ver-1',
    subject_type: 'user',
    subject_id: 'user-1',
    provider: 'sumsub',
    provider_reference: 'sess-123',
    status: 'pending',
    level: 'none',
    verified_at: null,
    expires_at: null,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------
describe('KycService.createSession', () => {
  it('creates a new verification via the provider when no record exists', async () => {
    const inserted = record();
    const { svc, provider } = buildService({
      getClientCalls: [chainMock(null), chainMock(inserted)],
    });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createSession).toHaveBeenCalledWith({ userId: 'user-1', metadata: {} });
    expect(verification).toEqual(inserted);
  });

  it('returns the existing record without calling the provider when pending', async () => {
    const existing = record({ status: 'pending' });
    const { svc, provider } = buildService({ getClientCalls: [chainMock(existing)] });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createSession).not.toHaveBeenCalled();
    expect(verification).toEqual(existing);
  });

  it('treats DB pending as a live session (in_review maps to pending in DB)', async () => {
    // The provider may report in_review, but mapProviderStatus stores it as
    // 'pending' in the verifications table (CHECK constraint). This test
    // verifies that a pending row is treated as a live session and not retried.
    const existing = record({ status: 'pending' });
    const { svc, provider } = buildService({ getClientCalls: [chainMock(existing)] });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createSession).not.toHaveBeenCalled();
    expect(verification).toEqual(existing);
  });

  it('returns the existing record without calling the provider when verified', async () => {
    const existing = record({ status: 'verified', verified_at: '2026-01-02T00:00:00Z' });
    const { svc, provider } = buildService({ getClientCalls: [chainMock(existing)] });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createSession).not.toHaveBeenCalled();
    expect(verification.status).toBe('verified');
  });

  it('allows a fresh attempt via the provider when previously rejected', async () => {
    const existing = record({ status: 'rejected' });
    const updated = record({ status: 'pending', provider_reference: 'sess-456' });
    const { svc, provider } = buildService({
      getClientCalls: [chainMock(existing), chainMock(updated)],
      providerSession: { providerVerificationId: 'sess-456' },
    });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createSession).toHaveBeenCalled();
    expect(verification.status).toBe('pending');
  });

  it('allows a fresh attempt via the provider when previously expired', async () => {
    // Expired sessions should be treated the same as rejected: call the
    // provider again and UPDATE the existing row (not INSERT, which would
    // hit the unique constraint and return the stale expired row).
    const existing = record({ status: 'expired' });
    const updated = record({ status: 'pending', provider_reference: 'sess-789' });
    const { svc, provider } = buildService({
      getClientCalls: [chainMock(existing), chainMock(updated)],
      providerSession: { providerVerificationId: 'sess-789' },
    });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createSession).toHaveBeenCalled();
    expect(verification.status).toBe('pending');
    expect(verification.provider_reference).toBe('sess-789');
  });

  it('allows a fresh attempt via the provider when previously unverified', async () => {
    const existing = record({ status: 'unverified' });
    const updated = record({ status: 'pending', provider_reference: 'sess-abc' });
    const { svc, provider } = buildService({
      getClientCalls: [chainMock(existing), chainMock(updated)],
      providerSession: { providerVerificationId: 'sess-abc' },
    });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createSession).toHaveBeenCalled();
    expect(verification.status).toBe('pending');
  });

  it('recovers when a concurrent request wins the unique-constraint race on insert', async () => {
    // First findByUserId sees nothing (both requests raced past the check), the
    // INSERT hits the DB's UNIQUE(subject_type, subject_id, provider) constraint
    // (23505), and the service must fall back to fetching the row the other request
    // just created.
    const wonByOtherRequest = record();
    const { svc, provider } = buildService({
      getClientCalls: [
        chainMock(null), // findByUserId: not found yet
        chainMock(null, {
          code: '23505',
          message: 'duplicate key value violates unique constraint',
        }), // insert loses the race
        chainMock(wonByOtherRequest), // re-fetch after 23505
      ],
    });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createSession).toHaveBeenCalled();
    expect(verification).toEqual(wonByOtherRequest);
  });

  it('throws BadRequestException when the provider call fails', async () => {
    const { svc, provider } = buildService({
      getClientCalls: [chainMock(null)],
    });
    provider.createSession.mockRejectedValue(new Error('Provider unavailable'));

    await expect(svc.createSession('user-1', baseDto)).rejects.toThrow('Provider unavailable');
  });

  it('throws BadRequestException when the DB insert fails', async () => {
    const { svc } = buildService({
      getClientCalls: [
        chainMock(null), // findByUserId: not found
        chainMock(null, { code: 'XX000', message: 'DB connection lost' }), // insert fails
      ],
    });

    await expect(svc.createSession('user-1', baseDto)).rejects.toThrow(BadRequestException);
  });

  it('passes metadata through to the provider', async () => {
    const inserted = record();
    const { svc, provider } = buildService({
      getClientCalls: [chainMock(null), chainMock(inserted)],
    });

    const dtoWithMeta: CreateKycSessionDto = {
      metadata: { locale: 'es', documentType: 'passport' },
    };
    await svc.createSession('user-1', dtoWithMeta);

    expect(provider.createSession).toHaveBeenCalledWith({
      userId: 'user-1',
      metadata: { locale: 'es', documentType: 'passport' },
    });
  });

  it('throws BadRequestException when the DB update fails on retryable status', async () => {
    const existing = record({ status: 'expired' });
    const { svc, provider } = buildService({
      getClientCalls: [
        chainMock(existing), // findByUserId: found expired
        chainMock(null, { code: 'XX000', message: 'DB update failed' }), // update fails
      ],
    });

    await expect(svc.createSession('user-1', baseDto)).rejects.toThrow(BadRequestException);
    expect(provider.createSession).toHaveBeenCalled();
  });
});

describe('KycService.handleWebhookProcessed', () => {
  it('updates verification record based on webhook payload', async () => {
    const { svc, getClient } = buildService({ getClientCalls: [chainMock([{ id: 'rec-1' }])] });
    await svc.handleWebhookProcessed({
      providerVerificationId: 'sess-1',
      result: { status: 'verified' as any, verifiedAt: new Date().toISOString() },
    });
    expect(getClient).toHaveBeenCalled();
  });
});
