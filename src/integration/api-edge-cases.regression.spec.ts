/**
 * Regression: issue #15 / #51 · PR #57
 * Bug: API edge cases — invalid JWT, missing agreement IDs, and unauthorized
 * by-wallet access did not consistently return 401 / 404 / 403.
 */
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../supabase/supabase.service';
import { AgreementSyncService } from '../agreements/sync/agreement-sync.service';
import { AgreementValidationService } from '../agreements/validation/agreement-validation.service';
import { AgreementsController } from '../agreements/agreements.controller';
import { AgreementActivityService } from '../agreements/agreement-activity.service';
import { AgreementsService } from '../agreements/agreements.service';

type Row = Record<string, unknown>;

const JWT_SECRET = 'dev-insecure-change-me';
const USER_ID = 'staging-user-1';
const OTHER_USER_ID = 'staging-user-2';
const WALLET = 'GSTAGINGUSERWALLET000000000000000000000000000000000000000';
const OTHER_WALLET = 'GSTAGINGOTHERWALLET000000000000000000000000000000000';
const AGREEMENT_ID = '550e8400-e29b-41d4-a716-446655440000';

class QueryBuilder implements PromiseLike<{ data?: unknown; error: unknown }> {
  private filters: Array<{ key: string; value: unknown }> = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: Row | null = null;
  private resultMode: 'many' | 'single' | 'maybeSingle' = 'many';

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
  in(key: string, values: unknown[]) {
    this.filters.push({ key, value: values });
    return this;
  }
  insert(data: Row) {
    this.mode = 'insert';
    this.payload = data;
    return this;
  }
  update(data: Row) {
    this.mode = 'update';
    this.payload = data;
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  single() {
    this.resultMode = 'single';
    return this;
  }
  maybeSingle() {
    this.resultMode = 'maybeSingle';
    return this;
  }

  then<TResult1 = { data?: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      ((value: { data?: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<{ data?: unknown; error: unknown }> {
    const rows = this.db.tables[this.table] ?? [];
    if (this.mode === 'insert') {
      const inserted = { id: `${this.table}-${rows.length + 1}`, ...this.payload };
      this.db.tables[this.table] = [...rows, inserted];
      return Promise.resolve({ data: inserted, error: null });
    }

    const matched = rows.filter((row) =>
      this.filters.every((f) => {
        if (Array.isArray(f.value)) return (f.value as unknown[]).includes(row[f.key]);
        return row[f.key] === f.value;
      }),
    );

    if (this.mode === 'update') {
      for (const row of matched) Object.assign(row, this.payload);
    }

    if (this.resultMode === 'single') {
      if (!matched[0]) {
        return Promise.resolve({
          data: null,
          error: { message: 'not found', code: 'PGRST116' },
        });
      }
      return Promise.resolve({ data: matched[0], error: null });
    }
    if (this.resultMode === 'maybeSingle') {
      return Promise.resolve({ data: matched[0] ?? null, error: null });
    }
    return Promise.resolve({ data: matched, error: null });
  }
}

class FakeSupabase {
  tables: Record<string, Row[]> = {};

  constructor() {
    this.reset();
  }

  reset() {
    this.tables = {
      auth_users: [
        { id: USER_ID, wallet_public_key: WALLET },
        { id: OTHER_USER_ID, wallet_public_key: OTHER_WALLET },
      ],
      agreements: [
        {
          id: AGREEMENT_ID,
          title: 'Staging escrow agreement',
          amount: '100.00',
          asset: 'USDC',
          status: 'active',
          created_by: WALLET,
          milestones: [],
          metadata: {},
        },
      ],
      agreement_participants: [
        { id: 'p1', agreement_id: AGREEMENT_ID, wallet_address: WALLET, role: 'payer' },
      ],
      agreement_activity: [],
    };
  }

  getClient() {
    return { from: (table: string) => new QueryBuilder(this, table) };
  }
}

describe('regression: API edge cases (issue #15 / #51 · PR #57)', () => {
  let app: INestApplication;
  let supabase: FakeSupabase;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    supabase = new FakeSupabase();

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [AgreementsController],
      providers: [
        AgreementsService,
        providers: [
          AgreementsService,
          AgreementActivityService,
          AgreementSyncService,
          AgreementValidationService,
          { provide: SupabaseService, useValue: supabase },
          { provide: ConfigService, useValue: { get: jest.fn(() => JWT_SECRET) } },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    supabase.reset();
  });

  afterAll(async () => {
    await app?.close();
  });

  const tokenFor = (sub = USER_ID) =>
    jwt.sign({ sub, email: `${sub}@example.com` }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '7d',
    });
  const auth = (sub = USER_ID) => ({ Authorization: `Bearer ${tokenFor(sub)}` });

  it('rejects invalid JWT with 401', async () => {
    await request(app.getHttpServer())
      .get(`/v1/agreements/by-wallet?wallet=${WALLET}`)
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    await request(app.getHttpServer())
      .get(`/v1/agreements/${AGREEMENT_ID}`)
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('returns 404 for a missing agreement id', async () => {
    const missingId = '550e8400-e29b-41d4-a716-446655440999';
    await request(app.getHttpServer()).get(`/v1/agreements/${missingId}`).set(auth()).expect(404);
  });

  it('returns 403 for by-wallet when the JWT user does not own the wallet', async () => {
    await request(app.getHttpServer())
      .get(`/v1/agreements/by-wallet?wallet=${OTHER_WALLET}`)
      .set(auth(USER_ID))
      .expect(403);
  });
});
