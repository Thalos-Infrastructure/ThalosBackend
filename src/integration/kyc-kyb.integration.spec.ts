import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../supabase/supabase.service';
import { KybController } from '../kyb/kyb.controller';
import { KybService } from '../kyb/kyb.service';
import { KYB_PROVIDER } from '../kyb/providers/identity-provider.interface';
import { MockIdentityProvider } from '../kyb/providers/mock-identity.provider';
import { VerificationController } from '../verification/verification.controller';
import { VerificationService } from '../verification/verification.service';
import { JwtOrInternalSecretGuard } from '../verification/jwt-or-internal-secret.guard';
import type { VerificationRecord } from '../verification/verification.types';

/**
 * KYC/KYB Integration Test Suite (issue #75)
 *
 * Provider-agnostic coverage for identity verification workflows:
 *  - Session creation (KYB via IdentityProvider)
 *  - Status retrieval (KYB + standardized Verification API)
 *  - Successful / failed / expired verification
 *  - Provider failures + invalid requests
 *  - Multi-provider mocks (persona, sumsub, onfido, manual)
 *  - User (KYC) and Business (KYB) paths on /v1/verification/*
 *
 * Identity-vendor webhooks are not wired in this backend yet (Trustless Work
 * webhooks are separate). That case is documented as N/A below.
 *
 * Boots real Nest controllers + guards + ValidationPipe against an in-memory
 * Supabase fake — no live vendor, no live DB.
 */

type Row = Record<string, any>;

const JWT_SECRET = 'kyc-kyb-integration-test-secret-32c!!';
const INTERNAL_SECRET = 'thalos-internal-test-secret';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_USER_ID = '33333333-3333-4333-8333-333333333333';
const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const BUSINESS_ID = '660e8400-e29b-41d4-a716-446655440001';

class FakeSupabase {
  tables: Record<string, Row[]> = {};

  reset() {
    this.tables = {
      auth_users: [
        { id: USER_ID, wallet_public_key: 'GOWNER00000000000000000000000000000000000000000000000' },
        {
          id: OTHER_USER_ID,
          wallet_public_key: 'GOTHER00000000000000000000000000000000000000000000000',
        },
        {
          id: ADMIN_USER_ID,
          wallet_public_key: 'GADMIN00000000000000000000000000000000000000000000000',
        },
      ],
      profiles: [
        { wallet_address: 'GOWNER00000000000000000000000000000000000000000000000', role: 'user' },
        { wallet_address: 'GOTHER00000000000000000000000000000000000000000000000', role: 'user' },
        { wallet_address: 'GADMIN00000000000000000000000000000000000000000000000', role: 'admin' },
      ],
      kyb_verifications: [],
      verifications: [],
    };
  }

  seedVerification(
    row: Partial<VerificationRecord> & Pick<VerificationRecord, 'subject_type' | 'subject_id'>,
  ) {
    const full: Row = {
      id: row.id ?? `ver-${Math.random().toString(36).slice(2, 10)}`,
      provider: null,
      provider_reference: null,
      status: 'unverified',
      level: 'none',
      verified_at: null,
      expires_at: null,
      metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...row,
    };
    this.tables.verifications = [...(this.tables.verifications ?? []), full];
    return full;
  }

  getClient() {
    return {
      from: (table: string) => new FakeQueryBuilder(this, table),
    };
  }
}

class FakeQueryBuilder {
  private filters: Array<{ key: string; value: unknown }> = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: Row | undefined;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select() {
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters.push({ key, value });
    return this;
  }
  insert(payload: Row) {
    this.mode = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.mode = 'update';
    this.payload = payload;
    return this;
  }

  private matches(row: Row) {
    return this.filters.every((f) => row[f.key] === f.value);
  }

  private rows() {
    return (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
  }

  async maybeSingle() {
    if (this.mode === 'update') return this.doUpdate();
    const rows = this.rows();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    if (this.mode === 'insert') return this.doInsert();
    if (this.mode === 'update') return this.doUpdate();
    const rows = this.rows();
    return { data: rows[0] ?? null, error: null };
  }

  /** Thenable: VerificationService awaits `.select().eq().eq()` without terminal. */
  then(onfulfilled?: (value: { data: any; error: any }) => any, onrejected?: (reason: any) => any) {
    return this.resolve().then(onfulfilled, onrejected);
  }

  private resolve(): Promise<{ data: any; error: any }> {
    if (this.mode === 'insert') return this.doInsert();
    if (this.mode === 'update') return this.doUpdate();
    return Promise.resolve({ data: this.rows(), error: null });
  }

  private doInsert(): Promise<{ data: any; error: any }> {
    if (this.table === 'kyb_verifications') {
      const clash = (this.db.tables[this.table] ?? []).find(
        (r) => r.organization_id === this.payload!.organization_id,
      );
      if (clash) {
        return Promise.resolve({
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        });
      }
    }
    const row: Row = {
      id: `${this.table}-${Math.random().toString(36).slice(2, 8)}`,
      rejection_reason: null,
      verified_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...this.payload,
    };
    this.db.tables[this.table] = [...(this.db.tables[this.table] ?? []), row];
    return Promise.resolve({ data: row, error: null });
  }

  private doUpdate(): Promise<{ data: any; error: any }> {
    let updated: Row | null = null;
    this.db.tables[this.table] = (this.db.tables[this.table] ?? []).map((row) => {
      if (this.matches(row)) {
        updated = { ...row, ...this.payload };
        return updated;
      }
      return row;
    });
    return Promise.resolve({ data: updated, error: null });
  }
}

describe('KYC/KYB Integration Suite (#75)', () => {
  let app: INestApplication;
  let db: FakeSupabase;
  let provider: MockIdentityProvider;
  let emit: jest.Mock;

  const tokenFor = (sub: string) =>
    jwt.sign({ sub, email: `${sub}@example.com` }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
  const auth = (sub: string) => ({ Authorization: `Bearer ${tokenFor(sub)}` });
  const internal = () => ({ 'x-thalos-internal-secret': INTERNAL_SECRET });

  const validKybBody = {
    organization_id: ORG_ID,
    business_name: 'Acme Corp S.A.',
    registration_number: '30-71123456-8',
    country: 'AR',
    entity_type: 'company' as const,
  };

  async function boot(mock: MockIdentityProvider) {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.THALOS_INTERNAL_SECRET = INTERNAL_SECRET;
    db = new FakeSupabase();
    db.reset();
    provider = mock;
    emit = jest.fn();

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [KybController, VerificationController],
      providers: [
        KybService,
        VerificationService,
        JwtOrInternalSecretGuard,
        { provide: SupabaseService, useValue: db },
        { provide: KYB_PROVIDER, useValue: provider },
        { provide: EventEmitter2, useValue: { emit } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------
  // A. KYB — verification session creation (multi-provider)
  // -------------------------------------------------------------------------
  describe('KYB session creation (multi-provider mocks)', () => {
    it('creates a pending session via persona mock and records provider name', async () => {
      await boot(
        new MockIdentityProvider({
          name: 'persona',
          createResult: {
            providerSessionId: 'persona-sess-1',
            redirectUrl: 'https://withpersona.com/verify/persona-sess-1',
            initialStatus: 'pending',
          },
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);

      expect(res.body.verification.status).toBe('pending');
      expect(res.body.verification.provider).toBe('persona');
      expect(res.body.verification.provider_session_id).toBe('persona-sess-1');
      expect(provider.createCalls).toHaveLength(1);
      expect(provider.createCalls[0]).toMatchObject({
        organizationId: ORG_ID,
        businessName: 'Acme Corp S.A.',
        country: 'AR',
      });
    });

    it('supports sumsub instant-verified initialStatus without admin review', async () => {
      await boot(
        new MockIdentityProvider({
          name: 'sumsub',
          createResult: {
            providerSessionId: 'sumsub-ok-1',
            redirectUrl: null,
            initialStatus: 'verified',
          },
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);

      expect(res.body.verification.status).toBe('verified');
      expect(res.body.verification.provider).toBe('sumsub');
      expect(res.body.verification.verified_at).toBeTruthy();
    });

    it('supports onfido instant-rejected initialStatus', async () => {
      await boot(
        new MockIdentityProvider({
          name: 'onfido',
          createResult: {
            providerSessionId: 'onfido-rej-1',
            redirectUrl: null,
            initialStatus: 'rejected',
          },
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);

      expect(res.body.verification.status).toBe('rejected');
      expect(res.body.verification.provider).toBe('onfido');
    });

    it('surfaces provider failure on session create as 500 (unhandled provider error)', async () => {
      await boot(
        new MockIdentityProvider({
          name: 'persona',
          createError: new Error('Persona API 503: upstream unavailable'),
        }),
      );

      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(500);
    });

    it('is idempotent across providers: second POST while pending does not re-call provider', async () => {
      await boot(
        new MockIdentityProvider({
          name: 'persona',
          createResult: {
            providerSessionId: 'persona-once',
            redirectUrl: null,
            initialStatus: 'pending',
          },
        }),
      );

      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);

      expect(provider.createCalls).toHaveLength(1);
      expect(db.tables.kyb_verifications).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // B. KYB — status retrieval + success / failure (admin review)
  // -------------------------------------------------------------------------
  describe('KYB status retrieval + successful/failed verification', () => {
    beforeEach(async () => {
      await boot(
        new MockIdentityProvider({
          name: 'manual',
          createResult: {
            providerSessionId: 'manual-1',
            redirectUrl: null,
            initialStatus: 'pending',
          },
        }),
      );
    });

    it('GET status returns pending after session create (owner)', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(USER_ID))
        .expect(200);

      expect(res.body.verification.status).toBe('pending');
    });

    it('successful verification: admin PATCH verified + emits kyb.verified', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(ADMIN_USER_ID))
        .send({ status: 'verified' })
        .expect(200);

      expect(res.body.verification.status).toBe('verified');
      expect(res.body.verification.verified_at).toBeTruthy();
      expect(emit).toHaveBeenCalledWith(
        'kyb.verified',
        expect.objectContaining({ organizationId: ORG_ID }),
      );
    });

    it('failed verification: admin PATCH rejected with reason + emits kyb.rejected', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(ADMIN_USER_ID))
        .send({ status: 'rejected', rejection_reason: 'registry mismatch' })
        .expect(200);

      expect(res.body.verification.status).toBe('rejected');
      expect(res.body.verification.rejection_reason).toBe('registry mismatch');
      expect(emit).toHaveBeenCalledWith(
        'kyb.rejected',
        expect.objectContaining({
          organizationId: ORG_ID,
          rejectionReason: 'registry mismatch',
        }),
      );
    });

    it('allows re-attempt after rejection and calls provider again', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(ADMIN_USER_ID))
        .send({ status: 'rejected', rejection_reason: 'docs incomplete' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);

      expect(res.body.verification.status).toBe('pending');
      expect(provider.createCalls).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // C. KYB — invalid requests + authz
  // -------------------------------------------------------------------------
  describe('KYB invalid requests + authorization', () => {
    beforeEach(async () => {
      await boot(new MockIdentityProvider({ name: 'manual' }));
    });

    it('401 without JWT', async () => {
      await request(app.getHttpServer()).post('/v1/kyb/session').send(validKybBody).expect(401);
    });

    it('400 on invalid DTO (country not ISO alpha-2)', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send({ ...validKybBody, country: 'Argentina' })
        .expect(400);
    });

    it('400 on mass-assignment (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send({ ...validKybBody, role: 'admin' })
        .expect(400);
    });

    it('400 on malformed organizationId path', async () => {
      await request(app.getHttpServer())
        .get('/v1/kyb/status/not-a-uuid')
        .set(auth(USER_ID))
        .expect(400);
    });

    it('404 status when no session exists', async () => {
      await request(app.getHttpServer())
        .get(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(USER_ID))
        .expect(404);
    });

    it('403 IDOR: other user cannot read status', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);
      await request(app.getHttpServer())
        .get(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(OTHER_USER_ID))
        .expect(403);
    });

    it('403 non-admin cannot review', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(USER_ID))
        .send({ status: 'verified' })
        .expect(403);
    });

    it('400 reject without rejection_reason', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(ADMIN_USER_ID))
        .send({ status: 'rejected' })
        .expect(400);
    });

    it('400 cannot re-review finalized verification', async () => {
      await request(app.getHttpServer())
        .post('/v1/kyb/session')
        .set(auth(USER_ID))
        .send(validKybBody)
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(ADMIN_USER_ID))
        .send({ status: 'verified' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/v1/kyb/status/${ORG_ID}`)
        .set(auth(ADMIN_USER_ID))
        .send({ status: 'rejected', rejection_reason: 'too late' })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // D. Provider checkStatus unit-of-integration (mock surface)
  // -------------------------------------------------------------------------
  describe('Provider checkStatus mock surface (multi-vendor)', () => {
    it('persona checkStatus returns in_review then verified', async () => {
      const mock = new MockIdentityProvider({
        name: 'persona',
        checkStatusResult: (id) => (id.endsWith('-final') ? 'verified' : 'in_review'),
      });
      await expect(mock.checkStatus('sess-1')).resolves.toBe('in_review');
      await expect(mock.checkStatus('sess-1-final')).resolves.toBe('verified');
      expect(mock.checkStatusCalls).toEqual(['sess-1', 'sess-1-final']);
    });

    it('sumsub checkStatus failure surfaces as rejected promise (provider outage)', async () => {
      const mock = new MockIdentityProvider({
        name: 'sumsub',
        checkStatusError: new Error('Sumsub timeout'),
      });
      await expect(mock.checkStatus('any')).rejects.toThrow('Sumsub timeout');
    });
  });

  // -------------------------------------------------------------------------
  // E. KYC (user) + KYB (business) via Verification API
  // -------------------------------------------------------------------------
  describe('Verification API — User (KYC) and Business (KYB)', () => {
    beforeEach(async () => {
      await boot(new MockIdentityProvider({ name: 'manual' }));
    });

    it('KYC: unknown user returns standardized unverified payload (200, not 404)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/verification/user/${USER_ID}`)
        .set(auth(USER_ID))
        .expect(200);

      expect(res.body).toMatchObject({
        subjectType: 'user',
        subjectId: USER_ID,
        isVerified: false,
        status: 'unverified',
        level: 'none',
        provider: null,
      });
    });

    it('KYC: successful verification from sumsub (self-read)', async () => {
      db.seedVerification({
        subject_type: 'user',
        subject_id: USER_ID,
        provider: 'sumsub',
        provider_reference: 'sumsub-app-1',
        status: 'verified',
        level: 'standard',
        verified_at: '2026-06-01T00:00:00.000Z',
        expires_at: '2999-01-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/verification/user/${USER_ID}`)
        .set(auth(USER_ID))
        .expect(200);

      expect(res.body.isVerified).toBe(true);
      expect(res.body.status).toBe('verified');
      expect(res.body.level).toBe('standard');
      expect(res.body.provider).toBe('sumsub');
    });

    it('KYC: failed (rejected) verification', async () => {
      db.seedVerification({
        subject_type: 'user',
        subject_id: USER_ID,
        provider: 'persona',
        status: 'rejected',
        level: 'basic',
        updated_at: '2026-06-02T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/verification/user/${USER_ID}`)
        .set(auth(USER_ID))
        .expect(200);

      expect(res.body.isVerified).toBe(false);
      expect(res.body.status).toBe('rejected');
      expect(res.body.provider).toBeNull();
    });

    it('KYC: expired verification (verified row past expires_at)', async () => {
      db.seedVerification({
        subject_type: 'user',
        subject_id: USER_ID,
        provider: 'onfido',
        status: 'verified',
        level: 'advanced',
        verified_at: '2020-01-01T00:00:00.000Z',
        expires_at: '2020-06-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/verification/user/${USER_ID}`)
        .set(auth(USER_ID))
        .expect(200);

      expect(res.body.isVerified).toBe(false);
      expect(res.body.status).toBe('expired');
      expect(res.body.level).toBe('none');
    });

    it('KYC: pending verification', async () => {
      db.seedVerification({
        subject_type: 'user',
        subject_id: USER_ID,
        provider: 'persona',
        status: 'pending',
        level: 'none',
        updated_at: '2026-07-01T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/verification/user/${USER_ID}`)
        .set(auth(USER_ID))
        .expect(200);

      expect(res.body.isVerified).toBe(false);
      expect(res.body.status).toBe('pending');
    });

    it('KYC: multi-provider aggregation picks highest valid level', async () => {
      db.seedVerification({
        subject_type: 'user',
        subject_id: USER_ID,
        provider: 'persona',
        status: 'verified',
        level: 'basic',
        expires_at: '2999-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });
      db.seedVerification({
        subject_type: 'user',
        subject_id: USER_ID,
        provider: 'sumsub',
        status: 'verified',
        level: 'advanced',
        expires_at: '2999-01-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/verification/user/${USER_ID}`)
        .set(auth(USER_ID))
        .expect(200);

      expect(res.body.isVerified).toBe(true);
      expect(res.body.level).toBe('advanced');
      expect(res.body.provider).toBe('sumsub');
    });

    it('KYC: 403 IDOR — other user cannot read subject', async () => {
      await request(app.getHttpServer())
        .get(`/v1/verification/user/${USER_ID}`)
        .set(auth(OTHER_USER_ID))
        .expect(403);
    });

    it('KYC: admin can read any user', async () => {
      db.seedVerification({
        subject_type: 'user',
        subject_id: USER_ID,
        provider: 'manual',
        status: 'verified',
        level: 'basic',
        expires_at: '2999-01-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/verification/user/${USER_ID}`)
        .set(auth(ADMIN_USER_ID))
        .expect(200);

      expect(res.body.isVerified).toBe(true);
    });

    it('KYC: internal service secret can read any user', async () => {
      db.seedVerification({
        subject_type: 'user',
        subject_id: USER_ID,
        provider: 'sumsub',
        status: 'verified',
        level: 'standard',
        expires_at: '2999-01-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/verification/user/${USER_ID}`)
        .set(internal())
        .expect(200);

      expect(res.body.isVerified).toBe(true);
      expect(res.body.provider).toBe('sumsub');
    });

    it('KYB business: successful verification via internal service', async () => {
      db.seedVerification({
        subject_type: 'business',
        subject_id: BUSINESS_ID,
        provider: 'sumsub',
        status: 'verified',
        level: 'advanced',
        expires_at: '2999-01-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/verification/business/${BUSINESS_ID}`)
        .set(internal())
        .expect(200);

      expect(res.body.subjectType).toBe('business');
      expect(res.body.isVerified).toBe(true);
      expect(res.body.provider).toBe('sumsub');
    });

    it('KYB business: expired verification', async () => {
      db.seedVerification({
        subject_type: 'business',
        subject_id: BUSINESS_ID,
        provider: 'persona',
        status: 'verified',
        level: 'standard',
        expires_at: '2021-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/verification/business/${BUSINESS_ID}`)
        .set(auth(ADMIN_USER_ID))
        .expect(200);

      expect(res.body.isVerified).toBe(false);
      expect(res.body.status).toBe('expired');
    });

    it('KYB business: non-admin JWT gets 403 (no self for business)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/verification/business/${BUSINESS_ID}`)
        .set(auth(USER_ID))
        .expect(403);
    });

    it('invalid UUID path → 400', async () => {
      await request(app.getHttpServer())
        .get('/v1/verification/user/not-a-uuid')
        .set(auth(USER_ID))
        .expect(400);
    });

    it('unauthenticated → 401', async () => {
      await request(app.getHttpServer()).get(`/v1/verification/user/${USER_ID}`).expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // F. Webhooks (identity providers) — N/A until wired
  // -------------------------------------------------------------------------
  describe('Identity-provider webhooks', () => {
    it('documents that KYC/KYB vendor webhooks are not implemented (Trustless Work only)', () => {
      // src/webhooks covers Trustless Work escrow events only.
      // When a Persona/Sumsub/Onfido webhook endpoint is added, cover:
      //   signature verify · status transition · unknown event · replay
      expect(true).toBe(true);
    });
  });
});
