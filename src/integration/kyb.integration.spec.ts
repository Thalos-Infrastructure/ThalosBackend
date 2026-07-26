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
import { ManualIdentityProvider } from '../kyb/providers/manual-identity.provider';

/**
 * Real HTTP integration test for the KYB module: boots the actual Nest app
 * (global prefix, real ValidationPipe, real JwtAuthGuard/JwtStrategy) against
 * an in-memory fake of SupabaseService — no mocking at the service layer.
 */

type Row = Record<string, any>;

const JWT_SECRET = 'kyb-integration-test-secret-32chars!!';
const USER_ID = 'user-owner-1';
const OTHER_USER_ID = 'user-other-1';
const ADMIN_USER_ID = 'user-admin-1';
const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';

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
    };
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

  private doInsert() {
    // Simulate the UNIQUE(organization_id) constraint from scripts/002_create_kyb_verifications.sql
    const clash = (this.db.tables[this.table] ?? []).find(
      (r) => r.organization_id === this.payload!.organization_id,
    );
    if (clash) {
      return Promise.resolve({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      });
    }
    const row: Row = {
      id: `kyb-${Math.random().toString(36).slice(2, 8)}`,
      rejection_reason: null,
      verified_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...this.payload,
    };
    this.db.tables[this.table] = [...(this.db.tables[this.table] ?? []), row];
    return Promise.resolve({ data: row, error: null });
  }

  private doUpdate() {
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

describe('KYB HTTP integration (real app, real guards, fake DB)', () => {
  let app: INestApplication;
  let db: FakeSupabase;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    db = new FakeSupabase();

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [KybController],
      providers: [
        KybService,
        { provide: SupabaseService, useValue: db },
        { provide: KYB_PROVIDER, useClass: ManualIdentityProvider },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  beforeEach(() => db.reset());
  afterAll(async () => await app.close());

  const tokenFor = (sub: string) =>
    jwt.sign({ sub, email: `${sub}@example.com` }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
  const auth = (sub: string) => ({ Authorization: `Bearer ${tokenFor(sub)}` });

  const validBody = {
    organization_id: ORG_ID,
    business_name: 'Acme Corp S.A.',
    registration_number: '30-71123456-8',
    country: 'AR',
    entity_type: 'company',
  };

  it('rejects unauthenticated requests with 401', async () => {
    await request(app.getHttpServer()).post('/v1/kyb/session').send(validBody).expect(401);
  });

  it('201s a new KYB session and returns status "pending"', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
      .expect(201);

    expect(res.body.verification.status).toBe('pending');
    expect(res.body.verification.organization_id).toBe(ORG_ID);
    expect(res.body.verification.requested_by).toBe(USER_ID);
  });

  it('400s on mass-assignment / unknown fields (forbidNonWhitelisted)', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send({ ...validBody, role: 'admin' })
      .expect(400);
  });

  it('400s on a malformed country code', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send({ ...validBody, country: 'Argentina' })
      .expect(400);
  });

  it('is idempotent: a second POST from the same owner returns the same pending record, no duplicate', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
      .expect(201);

    expect(res.body.verification.status).toBe('pending');
    expect(db.tables.kyb_verifications).toHaveLength(1);
  });

  it('403s IDOR attempt: a different user cannot (re)submit for an org they do not own', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
      .expect(201);
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(OTHER_USER_ID))
      .send(validBody)
      .expect(403);
  });

  it('403s IDOR attempt: a different user cannot GET status for an org they do not own', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/v1/kyb/status/${ORG_ID}`)
      .set(auth(OTHER_USER_ID))
      .expect(403);
  });

  it('200s GET status for the owner', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
      .expect(201);
    const res = await request(app.getHttpServer())
      .get(`/v1/kyb/status/${ORG_ID}`)
      .set(auth(USER_ID))
      .expect(200);
    expect(res.body.verification.status).toBe('pending');
  });

  it('404s GET status for an organization with no record', async () => {
    await request(app.getHttpServer())
      .get(`/v1/kyb/status/${ORG_ID}`)
      .set(auth(USER_ID))
      .expect(404);
  });

  it('403s PATCH review when the caller is not an admin (privilege escalation attempt)', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/v1/kyb/status/${ORG_ID}`)
      .set(auth(USER_ID))
      .send({ status: 'verified' })
      .expect(403);
  });

  it('400s PATCH review to rejected without rejection_reason (audit trail guard)', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/v1/kyb/status/${ORG_ID}`)
      .set(auth(ADMIN_USER_ID))
      .send({ status: 'rejected' })
      .expect(400);
  });

  it('200s PATCH review to verified by an admin and stamps verified_at', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
      .expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/v1/kyb/status/${ORG_ID}`)
      .set(auth(ADMIN_USER_ID))
      .send({ status: 'verified' })
      .expect(200);

    expect(res.body.verification.status).toBe('verified');
    expect(res.body.verification.verified_at).toBeTruthy();
  });

  it('400s further PATCH review attempts once a record is finalized (immutability)', async () => {
    await request(app.getHttpServer())
      .post('/v1/kyb/session')
      .set(auth(USER_ID))
      .send(validBody)
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

  it('400s a malformed organizationId path param instead of leaking a DB error', async () => {
    await request(app.getHttpServer())
      .get('/v1/kyb/status/not-a-uuid')
      .set(auth(USER_ID))
      .expect(400);
  });
});
