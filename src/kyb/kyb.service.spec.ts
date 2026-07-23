import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { KybService, KybVerification } from './kyb.service';
import { CreateKybSessionDto, ReviewKybSessionDto } from './dto/kyb.dto';
import type { VerificationSessionResult } from './providers/identity-provider.interface';

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
  providerSession?: Partial<VerificationSessionResult>;
}

function buildService(opts: BuildOpts = {}) {
  const calls = opts.getClientCalls ?? [];
  let callIndex = 0;
  const getClient = jest.fn().mockImplementation(() => calls[callIndex++]);
  const supabase = { getClient };

  const provider = {
    name: 'manual',
    createVerificationSession: jest.fn().mockResolvedValue({
      providerSessionId: 'sess-1',
      redirectUrl: null,
      initialStatus: 'pending',
      ...opts.providerSession,
    }),
    checkStatus: jest.fn(),
  };

  const emit = jest.fn();
  const eventEmitter = { emit };

  const svc = new (KybService as unknown as new (...args: unknown[]) => KybService)(
    supabase,
    provider,
    eventEmitter,
  );

  return { svc, provider, emit, getClient };
}

const baseDto: CreateKybSessionDto = {
  organization_id: 'org-1',
  business_name: 'Acme Inc.',
  registration_number: '12345',
  country: 'US',
  entity_type: 'company',
};

function record(overrides: Partial<KybVerification> = {}): KybVerification {
  return {
    id: 'kyb-1',
    organization_id: 'org-1',
    requested_by: 'user-1',
    entity_type: 'company',
    business_name: 'Acme Inc.',
    registration_number: '12345',
    country: 'US',
    status: 'pending',
    provider: 'manual',
    provider_session_id: 'sess-1',
    rejection_reason: null,
    verified_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------
describe('KybService.createSession', () => {
  it('creates a new verification via the provider when no record exists', async () => {
    const inserted = record();
    const { svc, provider } = buildService({
      getClientCalls: [chainMock(null), chainMock(inserted)],
    });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createVerificationSession).toHaveBeenCalledWith({
      organizationId: 'org-1',
      businessName: 'Acme Inc.',
      registrationNumber: '12345',
      country: 'US',
      entityType: 'company',
    });
    expect(verification).toEqual(inserted);
  });

  it('returns the existing record without calling the provider when pending', async () => {
    const existing = record({ status: 'pending' });
    const { svc, provider } = buildService({ getClientCalls: [chainMock(existing)] });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createVerificationSession).not.toHaveBeenCalled();
    expect(verification).toEqual(existing);
  });

  it('returns the existing record without calling the provider when verified', async () => {
    const existing = record({ status: 'verified', verified_at: '2026-01-02T00:00:00Z' });
    const { svc, provider } = buildService({ getClientCalls: [chainMock(existing)] });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createVerificationSession).not.toHaveBeenCalled();
    expect(verification.status).toBe('verified');
  });

  it('allows a fresh attempt via the provider when previously rejected', async () => {
    const existing = record({ status: 'rejected', rejection_reason: 'bad registry match' });
    const updated = record({ status: 'pending', rejection_reason: null });
    const { svc, provider } = buildService({
      getClientCalls: [chainMock(existing), chainMock(updated)],
    });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createVerificationSession).toHaveBeenCalled();
    expect(verification.status).toBe('pending');
    expect(verification.rejection_reason).toBeNull();
  });

  it('throws ForbiddenException when a different user tries to (re)submit an existing org', async () => {
    const existing = record({ requested_by: 'user-1' });
    const { svc } = buildService({ getClientCalls: [chainMock(existing)] });

    await expect(svc.createSession('user-2', baseDto)).rejects.toThrow(ForbiddenException);
  });

  it('recovers when a concurrent request wins the unique-constraint race on insert', async () => {
    // First findByOrganizationId sees nothing (both requests raced past the check),
    // the INSERT hits the DB's UNIQUE(organization_id) constraint (23505), and the
    // service must fall back to fetching the row the other request just created.
    const wonByOtherRequest = record();
    const { svc, provider } = buildService({
      getClientCalls: [
        chainMock(null), // findByOrganizationId: not found yet
        chainMock(null, {
          code: '23505',
          message: 'duplicate key value violates unique constraint',
        }), // insert loses the race
        chainMock(wonByOtherRequest), // re-fetch after 23505
      ],
    });

    const { verification } = await svc.createSession('user-1', baseDto);

    expect(provider.createVerificationSession).toHaveBeenCalled();
    expect(verification).toEqual(wonByOtherRequest);
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------
describe('KybService.getStatus', () => {
  it('returns the verification for its requester', async () => {
    const existing = record({ requested_by: 'user-1' });
    const { svc } = buildService({ getClientCalls: [chainMock(existing)] });

    const { verification } = await svc.getStatus('user-1', 'org-1');
    expect(verification).toEqual(existing);
  });

  it('throws NotFoundException when no record exists for the organization', async () => {
    const { svc } = buildService({ getClientCalls: [chainMock(null)] });
    await expect(svc.getStatus('user-1', 'ghost-org')).rejects.toThrow(NotFoundException);
  });

  it('allows an admin (non-requester) to view the status', async () => {
    const existing = record({ requested_by: 'user-1' });
    const { svc } = buildService({
      getClientCalls: [
        chainMock(existing), // findByOrganizationId
        chainMock({ wallet_public_key: 'GADMIN' }), // isAdmin: auth_users lookup
        chainMock({ role: 'admin' }), // isAdmin: profiles lookup
      ],
    });

    const { verification } = await svc.getStatus('user-admin', 'org-1');
    expect(verification).toEqual(existing);
  });

  it('throws ForbiddenException for a non-requester, non-admin user', async () => {
    const existing = record({ requested_by: 'user-1' });
    const { svc } = buildService({
      getClientCalls: [chainMock(existing), chainMock(null), chainMock(null)],
    });

    await expect(svc.getStatus('user-2', 'org-1')).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------
describe('KybService.review', () => {
  const reviewDto: ReviewKybSessionDto = { status: 'verified' };

  it('throws ForbiddenException when the caller is not an admin', async () => {
    const { svc } = buildService({ getClientCalls: [chainMock(null), chainMock(null)] });
    await expect(svc.review('user-1', 'org-1', reviewDto)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when no record exists for the organization', async () => {
    const { svc } = buildService({
      getClientCalls: [
        chainMock({ wallet_public_key: 'GADMIN' }),
        chainMock({ role: 'admin' }),
        chainMock(null),
      ],
    });
    await expect(svc.review('user-admin', 'ghost-org', reviewDto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException when the record is already finalized', async () => {
    const existing = record({ status: 'verified' });
    const { svc } = buildService({
      getClientCalls: [
        chainMock({ wallet_public_key: 'GADMIN' }),
        chainMock({ role: 'admin' }),
        chainMock(existing),
      ],
    });
    await expect(svc.review('user-admin', 'org-1', reviewDto)).rejects.toThrow(BadRequestException);
  });

  it('transitions to verified, stamps verified_at, and emits kyb.verified', async () => {
    const existing = record({ status: 'in_review' });
    const updated = record({ status: 'verified', verified_at: '2026-01-03T00:00:00Z' });
    const { svc, emit } = buildService({
      getClientCalls: [
        chainMock({ wallet_public_key: 'GADMIN' }),
        chainMock({ role: 'admin' }),
        chainMock(existing),
        chainMock(updated),
      ],
    });

    const { verification } = await svc.review('user-admin', 'org-1', { status: 'verified' });

    expect(verification.status).toBe('verified');
    expect(verification.verified_at).toBe('2026-01-03T00:00:00Z');
    expect(emit).toHaveBeenCalledWith(
      'kyb.verified',
      expect.objectContaining({ organizationId: 'org-1' }),
    );
  });

  it('transitions to rejected with a reason and emits kyb.rejected', async () => {
    const existing = record({ status: 'pending' });
    const updated = record({ status: 'rejected', rejection_reason: 'mismatch' });
    const { svc, emit } = buildService({
      getClientCalls: [
        chainMock({ wallet_public_key: 'GADMIN' }),
        chainMock({ role: 'admin' }),
        chainMock(existing),
        chainMock(updated),
      ],
    });

    const { verification } = await svc.review('user-admin', 'org-1', {
      status: 'rejected',
      rejection_reason: 'mismatch',
    });

    expect(verification.status).toBe('rejected');
    expect(emit).toHaveBeenCalledWith(
      'kyb.rejected',
      expect.objectContaining({ organizationId: 'org-1', rejectionReason: 'mismatch' }),
    );
  });
});

// ---------------------------------------------------------------------------
// isVerified
// ---------------------------------------------------------------------------
describe('KybService.isVerified', () => {
  it('returns true only when status is verified', async () => {
    const { svc } = buildService({ getClientCalls: [chainMock(record({ status: 'verified' }))] });
    await expect(svc.isVerified('org-1')).resolves.toBe(true);
  });

  it('returns false for pending/in_review/rejected/missing', async () => {
    const { svc } = buildService({ getClientCalls: [chainMock(record({ status: 'pending' }))] });
    await expect(svc.isVerified('org-1')).resolves.toBe(false);
  });
});
