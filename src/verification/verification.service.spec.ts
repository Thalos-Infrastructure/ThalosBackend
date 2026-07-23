import { ForbiddenException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { SupabaseService } from '../supabase/supabase.service';
import { VerificationAccessContext, VerificationRecord } from './verification.types';

type QueryResult = { data: VerificationRecord[] | null; error: { message: string } | null };

/** An internal service caller bypasses subject/admin checks — handy for the aggregation tests. */
const INTERNAL: VerificationAccessContext = { isInternalService: true };

/**
 * Minimal Supabase stub: `from().select().eq().eq()` resolves to `result`.
 * Every builder method returns the same thenable builder, so the terminal
 * `await` in the service receives `result`. `maybeSingle()` resolves to no row
 * (only reached by the admin lookup, which the aggregation tests avoid).
 */
function supabaseReturning(result: QueryResult): SupabaseService {
  const thenable = Promise.resolve(result);
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: null }),
    then: thenable.then.bind(thenable),
    catch: thenable.catch.bind(thenable),
    finally: thenable.finally.bind(thenable),
  };
  const client = { from: () => builder };
  return { getClient: () => client } as unknown as SupabaseService;
}

/**
 * Table-aware stub for the authorization tests: `verifications` resolves to
 * `records`, while `auth_users` / `profiles` back the `isAdmin` lookup.
 */
function supabaseFor(opts: {
  records?: QueryResult;
  authUser?: { wallet_public_key?: string } | null;
  profile?: { role?: string } | null;
}): SupabaseService {
  const records = opts.records ?? { data: [], error: null };
  const client = {
    from: (table: string) => {
      if (table === 'verifications') {
        const thenable = Promise.resolve(records);
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          then: thenable.then.bind(thenable),
          catch: thenable.catch.bind(thenable),
          finally: thenable.finally.bind(thenable),
        };
        return b;
      }
      const data = table === 'auth_users' ? (opts.authUser ?? null) : (opts.profile ?? null);
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: () => Promise.resolve({ data }),
      };
      return b;
    },
  };
  return { getClient: () => client } as unknown as SupabaseService;
}

function record(overrides: Partial<VerificationRecord>): VerificationRecord {
  return {
    id: 'rec-1',
    subject_type: 'user',
    subject_id: 'user-1',
    provider: 'sumsub',
    provider_reference: null,
    status: 'unverified',
    level: 'none',
    verified_at: null,
    expires_at: null,
    metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const FUTURE = '2999-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';

describe('VerificationService', () => {
  it('returns an unverified default when the subject has no records', async () => {
    const service = new VerificationService(supabaseReturning({ data: [], error: null }));

    const res = await service.getUserVerification('user-1', INTERNAL);

    expect(res).toEqual({
      subjectType: 'user',
      subjectId: 'user-1',
      isVerified: false,
      status: 'unverified',
      level: 'none',
      provider: null,
      expiresAt: null,
      lastUpdated: null,
    });
  });

  it('reports isVerified for a currently-valid verified record', async () => {
    const service = new VerificationService(
      supabaseReturning({
        data: [
          record({
            status: 'verified',
            level: 'standard',
            provider: 'persona',
            expires_at: FUTURE,
            updated_at: '2026-05-01T00:00:00.000Z',
          }),
        ],
        error: null,
      }),
    );

    const res = await service.getUserVerification('user-1', INTERNAL);

    expect(res.isVerified).toBe(true);
    expect(res.status).toBe('verified');
    expect(res.level).toBe('standard');
    expect(res.provider).toBe('persona');
    expect(res.expiresAt).toBe(FUTURE);
    expect(res.lastUpdated).toBe('2026-05-01T00:00:00.000Z');
  });

  it('treats a verified-but-expired record as expired, not verified', async () => {
    const service = new VerificationService(
      supabaseReturning({
        data: [record({ status: 'verified', level: 'advanced', expires_at: PAST })],
        error: null,
      }),
    );

    const res = await service.getUserVerification('user-1', INTERNAL);

    expect(res.isVerified).toBe(false);
    expect(res.status).toBe('expired');
    expect(res.level).toBe('none');
    expect(res.provider).toBeNull();
  });

  it('picks the highest level across providers when several are valid', async () => {
    const service = new VerificationService(
      supabaseReturning({
        data: [
          record({ id: 'a', provider: 'sumsub', status: 'verified', level: 'basic' }),
          record({ id: 'b', provider: 'persona', status: 'verified', level: 'advanced' }),
        ],
        error: null,
      }),
    );

    const res = await service.getBusinessVerification('biz-1', INTERNAL);

    expect(res.isVerified).toBe(true);
    expect(res.level).toBe('advanced');
    expect(res.provider).toBe('persona');
    expect(res.subjectType).toBe('business');
  });

  it('surfaces a pending state while a verification is in progress', async () => {
    const service = new VerificationService(
      supabaseReturning({
        data: [record({ status: 'pending', level: 'none' })],
        error: null,
      }),
    );

    const res = await service.getUserVerification('user-1', INTERNAL);

    expect(res.isVerified).toBe(false);
    expect(res.status).toBe('pending');
  });

  it('fails closed (unverified) on a database error', async () => {
    const service = new VerificationService(
      supabaseReturning({ data: null, error: { message: 'boom' } }),
    );

    const res = await service.getUserVerification('user-1', INTERNAL);

    expect(res.isVerified).toBe(false);
    expect(res.status).toBe('unverified');
  });

  describe('authorization', () => {
    it('lets a user read their own KYC status', async () => {
      const service = new VerificationService(supabaseFor({ records: { data: [], error: null } }));

      const res = await service.getUserVerification('user-1', { callerUserId: 'user-1' });

      expect(res.subjectId).toBe('user-1');
    });

    it('rejects a user reading another user’s KYC status', async () => {
      const service = new VerificationService(supabaseFor({ authUser: null }));

      await expect(
        service.getUserVerification('user-1', { callerUserId: 'someone-else' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an admin read any KYC status', async () => {
      const service = new VerificationService(
        supabaseFor({
          records: { data: [], error: null },
          authUser: { wallet_public_key: 'W' },
          profile: { role: 'admin' },
        }),
      );

      const res = await service.getUserVerification('user-1', { callerUserId: 'admin-1' });

      expect(res.subjectId).toBe('user-1');
    });

    it('rejects a non-admin, non-subject caller for a business status', async () => {
      const service = new VerificationService(
        supabaseFor({ authUser: { wallet_public_key: 'W' }, profile: { role: 'user' } }),
      );

      await expect(
        service.getBusinessVerification('biz-1', { callerUserId: 'user-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an internal service read a business status', async () => {
      const service = new VerificationService(supabaseFor({ records: { data: [], error: null } }));

      const res = await service.getBusinessVerification('biz-1', INTERNAL);

      expect(res.subjectId).toBe('biz-1');
    });
  });
});
