import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../supabase/supabase.service';
import { ApiClient } from '../common/api/api-client';
import { AgreementsController } from '../agreements/agreements.controller';
import { AgreementsService } from '../agreements/agreements.service';
import { DisputesController } from '../disputes/disputes.controller';
import { DisputesService } from '../disputes/disputes.service';
import { EscrowsController } from '../internal-trustless/escrows.controller';
import { WalletsController } from '../wallets/wallets.controller';
import { WalletsService } from '../wallets/wallets.service';

// WalletsService transitively imports @stellar/stellar-sdk, which ships ESM that
// ts-jest does not transform. The migrated flows under test never exercise
// on-chain signature verification, so stub the only symbol that is pulled in.
jest.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromPublicKey: () => ({ verify: () => true }),
  },
}));

type Row = Record<string, any>;
type QueryResult = { data?: any; error: { message: string; code?: string } | null; count?: number };

const JWT_SECRET = 'dev-insecure-change-me';
const USER_ID = 'staging-user-1';
const OTHER_USER_ID = 'staging-user-2';
const RESOLVER_USER_ID = 'staging-resolver-1';
const WALLET = 'GSTAGINGUSERWALLET000000000000000000000000000000000000000';
const SECOND_WALLET = 'GSTAGINGUSERSECOND000000000000000000000000000000000000';
const OTHER_WALLET = 'GSTAGINGOTHERWALLET000000000000000000000000000000000';
const RESOLVER_WALLET = 'GSTAGINGRESOLVER000000000000000000000000000000000000';
const AGREEMENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONTRACT_ID = 'contract-staging-1';

class QueryBuilder implements PromiseLike<QueryResult> {
  private selected: string | undefined;
  private filters: Array<{ key: string; op: 'eq' | 'neq' | 'in'; value: any }> = [];
  private orderBy: { key: string; ascending: boolean } | undefined;
  private rowLimit: number | undefined;
  private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: any;
  private resultMode: 'many' | 'single' | 'maybeSingle' = 'many';
  private countRequested = false;

  constructor(
    private readonly db: InMemorySupabase,
    private readonly table: string,
  ) {}

  select(columns = '*', options?: { count?: 'exact'; head?: boolean }) {
    this.selected = columns;
    this.countRequested = options?.count === 'exact';
    return this;
  }

  eq(key: string, value: any) {
    this.filters.push({ key, op: 'eq', value });
    return this;
  }

  neq(key: string, value: any) {
    this.filters.push({ key, op: 'neq', value });
    return this;
  }

  in(key: string, value: any[]) {
    this.filters.push({ key, op: 'in', value });
    return this;
  }

  order(key: string, options?: { ascending?: boolean }) {
    this.orderBy = { key, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number) {
    this.rowLimit = count;
    return this;
  }

  maybeSingle() {
    this.resultMode = 'maybeSingle';
    return this;
  }

  single() {
    this.resultMode = 'single';
    return this;
  }

  insert(payload: any) {
    this.mode = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: any) {
    this.mode = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.mode = 'delete';
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    const forcedError = this.db.consumeFailure(this.table, this.mode);
    if (forcedError) return { data: this.emptyData(), error: { message: forcedError } };

    if (this.mode === 'insert') return this.executeInsert();
    if (this.mode === 'update') return this.executeUpdate();
    if (this.mode === 'delete') return this.executeDelete();
    return this.executeSelect();
  }

  private executeInsert(): QueryResult {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
    const inserted = rows.map((row) => this.db.insert(this.table, row));
    const data = this.resultMode === 'many' && !this.selected ? null : inserted[0];
    return { data, error: null };
  }

  private executeUpdate(): QueryResult {
    this.db.update(this.table, this.filters, this.payload);
    return { data: null, error: null };
  }

  private executeDelete(): QueryResult {
    this.db.delete(this.table, this.filters);
    return { data: null, error: null };
  }

  private executeSelect(): QueryResult {
    let rows = this.db.select(this.table, this.filters, this.selected);
    if (this.orderBy) {
      rows = rows.sort((a, b) => {
        const av = a[this.orderBy!.key];
        const bv = b[this.orderBy!.key];
        if (av === bv) return 0;
        const result = av > bv ? 1 : -1;
        return this.orderBy!.ascending ? result : -result;
      });
    }
    if (this.rowLimit !== undefined) rows = rows.slice(0, this.rowLimit);

    if (this.countRequested) {
      return { data: null, count: rows.length, error: null };
    }
    if (this.resultMode === 'maybeSingle') {
      return { data: rows[0] ?? null, error: null };
    }
    if (this.resultMode === 'single') {
      return rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
    }
    return { data: rows, error: null };
  }

  private emptyData() {
    return this.resultMode === 'many' ? [] : null;
  }
}

class InMemorySupabase {
  readonly tables: Record<string, Row[]> = {};
  private sequence = 1;
  private failures: Array<{ table: string; mode: string; message: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.sequence = 1;
    this.failures = [];
    this.tables.auth_users = [
      { id: USER_ID, wallet_public_key: WALLET },
      { id: OTHER_USER_ID, wallet_public_key: OTHER_WALLET },
      { id: RESOLVER_USER_ID, wallet_public_key: RESOLVER_WALLET },
    ];
    this.tables.user_wallets = [
      this.wallet('wallet-1', USER_ID, WALLET, 'Staging primary', true),
      this.wallet('wallet-2', USER_ID, SECOND_WALLET, 'Staging secondary', false),
      this.wallet('wallet-3', OTHER_USER_ID, OTHER_WALLET, 'Other primary', true),
    ];
    this.tables.profiles = [
      { id: 'profile-1', wallet_address: WALLET, email: 'staging@example.com' },
      { id: 'profile-2', wallet_address: SECOND_WALLET, email: 'staging-2@example.com' },
      { id: 'profile-3', wallet_address: OTHER_WALLET, email: 'other@example.com' },
      { id: 'profile-4', wallet_address: RESOLVER_WALLET, email: 'resolver@example.com' },
    ];
    this.tables.agreements = [
      {
        id: AGREEMENT_ID,
        contract_id: CONTRACT_ID,
        title: 'Staging escrow agreement',
        description: 'Existing migrated flow fixture',
        amount: '100.00',
        asset: 'USDC',
        status: 'active',
        created_by: WALLET,
        milestones: [{ description: 'Milestone 1', amount: '100.00', status: 'pending' }],
        metadata: {},
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
    ];
    this.tables.agreement_participants = [
      { id: 'participant-1', agreement_id: AGREEMENT_ID, wallet_address: WALLET, role: 'payer' },
      {
        id: 'participant-2',
        agreement_id: AGREEMENT_ID,
        wallet_address: SECOND_WALLET,
        role: 'payee',
      },
    ];
    this.tables.agreement_activity = [];
    this.tables.disputes = [];
    this.tables.dispute_resolutions = [];
  }

  getClient() {
    return {
      from: (table: string) => new QueryBuilder(this, table),
    };
  }

  failOnce(table: string, mode: string, message: string) {
    this.failures.push({ table, mode, message });
  }

  consumeFailure(table: string, mode: string) {
    const index = this.failures.findIndex((f) => f.table === table && f.mode === mode);
    if (index === -1) return null;
    const [failure] = this.failures.splice(index, 1);
    return failure.message;
  }

  insert(table: string, row: Row) {
    const inserted = {
      id: row.id ?? `${table}-${this.sequence++}`,
      created_at: row.created_at ?? '2026-06-29T00:00:00.000Z',
      updated_at: row.updated_at ?? '2026-06-29T00:00:00.000Z',
      ...row,
    };
    this.tables[table] = [...(this.tables[table] ?? []), inserted];
    return { ...inserted };
  }

  update(table: string, filters: Array<{ key: string; op: string; value: any }>, payload: Row) {
    this.tables[table] = (this.tables[table] ?? []).map((row) =>
      this.matches(row, filters) ? { ...row, ...payload } : row,
    );
  }

  delete(table: string, filters: Array<{ key: string; op: string; value: any }>) {
    this.tables[table] = (this.tables[table] ?? []).filter((row) => !this.matches(row, filters));
  }

  select(table: string, filters: Array<{ key: string; op: string; value: any }>, columns?: string) {
    return (this.tables[table] ?? [])
      .filter((row) => this.matches(row, filters))
      .map((row) => this.project(table, row, columns));
  }

  private matches(row: Row, filters: Array<{ key: string; op: string; value: any }>) {
    return filters.every((filter) => {
      if (filter.op === 'eq') return row[filter.key] === filter.value;
      if (filter.op === 'neq') return row[filter.key] !== filter.value;
      if (filter.op === 'in') return filter.value.includes(row[filter.key]);
      return true;
    });
  }

  private project(table: string, row: Row, columns?: string) {
    const cloned = { ...row };
    if (table === 'agreement_participants' && columns?.includes('agreement:agreements')) {
      cloned.agreement =
        this.tables.agreements.find((agreement) => agreement.id === row.agreement_id) ?? null;
    }
    if (table === 'disputes' && columns?.includes('agreement:agreements')) {
      cloned.agreement =
        this.tables.agreements.find((agreement) => agreement.id === row.agreement_id) ?? null;
    }
    return cloned;
  }

  private wallet(id: string, userId: string, address: string, label: string, isPrimary: boolean) {
    return {
      id,
      user_id: userId,
      wallet_address: address,
      wallet_type: 'custodial',
      label,
      is_primary: isPrimary,
      is_verified: true,
      verified_at: '2026-06-01T00:00:00.000Z',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    };
  }
}

describe('migrated backend flows (integration)', () => {
  let app: INestApplication;
  let supabase: InMemorySupabase;
  let disputeAgreementSequence = 0;
  const apiClient = {
    get: jest.fn(),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TRUSTLESSWORK_API_URL = 'https://trustless-work.test';
    process.env.TRUSTLESSWORK_API_KEY = 'tw-test-key';

    supabase = new InMemorySupabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [AgreementsController, DisputesController, EscrowsController, WalletsController],
      providers: [
        AgreementsService,
        DisputesService,
        WalletsService,
        { provide: SupabaseService, useValue: supabase },
        { provide: ApiClient, useValue: apiClient },
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
    disputeAgreementSequence = 0;
    apiClient.get.mockReset();
    apiClient.get.mockResolvedValue({
      success: true,
      data: {
        balances: [
          { asset_type: 'native', balance: '12.5000000' },
          {
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
            balance: '44.2500000',
          },
        ],
      },
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ contractId: CONTRACT_ID, status: 'active' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // Sign HS256 tokens exactly as the frontend does; AuthModule only verifies them.
  const tokenFor = (sub = USER_ID) =>
    jwt.sign({ sub, email: `${sub}@example.com` }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '7d',
    });
  const auth = (sub = USER_ID) => ({ Authorization: `Bearer ${tokenFor(sub)}` });

  it('accepts the app login JWT and rejects invalid tokens', async () => {
    const token = tokenFor();
    expect(token.split('.')).toHaveLength(3);

    await request(app.getHttpServer())
      .get('/v1/wallets/with-balances')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.error).toBeNull();
        expect(body.wallets).toHaveLength(2);
      });

    await request(app.getHttpServer())
      .get('/v1/wallets/with-balances')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('returns wallets with balances and surfaces wallet read errors', async () => {
    await request(app.getHttpServer())
      .get('/v1/wallets/with-balances')
      .set(auth())
      .expect(200)
      .expect(({ body }) => {
        expect(body.error).toBeNull();
        expect(body.wallets[0]).toMatchObject({
          wallet_address: WALLET,
          balance: { xlm: '12.5000000', usdc: '44.2500000' },
          agreements_count: 1,
        });
      });

    supabase.failOnce('user_wallets', 'select', 'wallet read failed');
    await request(app.getHttpServer())
      .get('/v1/wallets/with-balances')
      .set(auth())
      .expect(200)
      .expect(({ body }) => {
        expect(body.wallets).toEqual([]);
        expect(body.error).toBe('wallet read failed');
      });
  });

  it('groups agreements by wallet and returns an error when wallet loading fails', async () => {
    await request(app.getHttpServer())
      .get('/v1/wallets/agreements')
      .set(auth())
      .expect(200)
      .expect(({ body }) => {
        expect(body.error).toBeNull();
        expect(body.wallets[0].agreements).toEqual([
          expect.objectContaining({
            id: AGREEMENT_ID,
            title: 'Staging escrow agreement',
            role: 'payer',
          }),
        ]);
      });

    supabase.failOnce('user_wallets', 'select', 'wallet grouping failed');
    await request(app.getHttpServer())
      .get('/v1/wallets/agreements')
      .set(auth())
      .expect(200)
      .expect(({ body }) => {
        expect(body.wallets).toEqual([]);
        expect(body.error).toBe('wallet grouping failed');
      });
  });

  it('creates agreements and rejects actor wallets that do not match the token', async () => {
    await request(app.getHttpServer())
      .post('/v1/agreements')
      .set(auth())
      .send({
        title: 'New integration agreement',
        description: 'Created from migrated flow tests',
        amount: '250.00',
        asset: 'USDC',
        created_by: WALLET,
        participants: [
          { wallet_address: WALLET, role: 'payer' },
          { wallet_address: SECOND_WALLET, role: 'payee' },
        ],
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.error).toBeNull();
        expect(body.agreement).toMatchObject({
          title: 'New integration agreement',
          amount: '250.00',
          created_by: WALLET,
        });
      });

    await request(app.getHttpServer())
      .post('/v1/agreements')
      .set(auth())
      .send({
        title: 'Bad actor',
        amount: '250.00',
        created_by: OTHER_WALLET,
        participants: [{ wallet_address: OTHER_WALLET, role: 'payer' }],
      })
      .expect(403);
  });

  it('lists agreements by wallet and rejects mismatched wallet queries', async () => {
    await request(app.getHttpServer())
      .get(`/v1/agreements/by-wallet?wallet=${WALLET}`)
      .set(auth())
      .expect(200)
      .expect(({ body }) => {
        expect(body.error).toBeNull();
        expect(body.agreements).toEqual([
          expect.objectContaining({ id: AGREEMENT_ID, contract_id: CONTRACT_ID }),
        ]);
      });

    await request(app.getHttpServer())
      .get(`/v1/agreements/by-wallet?wallet=${OTHER_WALLET}`)
      .set(auth())
      .expect(403);
  });

  it('opens disputes and rejects duplicate open disputes', async () => {
    await request(app.getHttpServer())
      .post('/v1/disputes')
      .set(auth())
      .send({
        agreement_id: AGREEMENT_ID,
        opened_by: WALLET,
        reason: 'Deliverable does not match scope',
        evidence_urls: ['https://example.test/evidence.png'],
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.error).toBeNull();
        expect(body.dispute).toMatchObject({
          agreement_id: AGREEMENT_ID,
          opened_by: WALLET,
          status: 'open',
        });
      });

    await request(app.getHttpServer())
      .post('/v1/disputes')
      .set(auth())
      .send({
        agreement_id: AGREEMENT_ID,
        opened_by: WALLET,
        reason: 'Still disputed',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.dispute).toBeNull();
        expect(body.error).toBe('There is already an open dispute for this agreement');
      });
  });

  it('resolves disputes and rejects bad percentages or unauthorized resolvers', async () => {
    const disputeId = await openAndAssignDispute();

    await request(app.getHttpServer())
      .patch(`/v1/disputes/${disputeId}/resolve`)
      .set(auth(RESOLVER_USER_ID))
      .send({
        resolved_by: RESOLVER_WALLET,
        payer_percentage: 45,
        payee_percentage: 55,
        resolution_notes: 'Partial delivery accepted',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.error).toBeNull();
        expect(body.resolution).toMatchObject({
          dispute_id: disputeId,
          resolved_by: RESOLVER_WALLET,
          payer_percentage: 45,
          payee_percentage: 55,
        });
      });

    const badPercentDisputeId = await openAndAssignDispute();
    await request(app.getHttpServer())
      .patch(`/v1/disputes/${badPercentDisputeId}/resolve`)
      .set(auth(RESOLVER_USER_ID))
      .send({
        resolved_by: RESOLVER_WALLET,
        payer_percentage: 45,
        payee_percentage: 40,
      })
      .expect(400);

    const unauthorizedDisputeId = await openAndAssignDispute();
    await request(app.getHttpServer())
      .patch(`/v1/disputes/${unauthorizedDisputeId}/resolve`)
      .set(auth())
      .send({
        resolved_by: WALLET,
        payer_percentage: 50,
        payee_percentage: 50,
      })
      .expect(403);
  });

  it('reads escrows through the Trustless Work relay and surfaces upstream errors', async () => {
    await request(app.getHttpServer())
      .get(`/v1/escrows/by-signer/${WALLET}`)
      .set(auth())
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([{ contractId: CONTRACT_ID, status: 'active' }]);
        // TW expects `signer` (not `address`) plus pagination flags — see escrows.controller.ts.
        expect(global.fetch).toHaveBeenCalledWith(
          `https://trustless-work.test/helper/get-escrows-by-signer?signer=${WALLET}&page=1&pageSize=5&validateOnChain=true`,
          expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({ 'x-api-key': 'tw-test-key' }),
          }),
        );
      });

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'upstream failed' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await request(app.getHttpServer())
      .get(`/v1/escrows/by-signer/${WALLET}`)
      .set(auth())
      .expect(400);
  });

  it('guards lib/api against direct Supabase calls', () => {
    const libApiPath = join(process.cwd(), 'lib', 'api');
    if (!existsSync(libApiPath)) return;

    const files = collectFiles(libApiPath).filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes('supabase.from('));
    expect(offenders).toEqual([]);
  });

  async function openAndAssignDispute() {
    disputeAgreementSequence += 1;
    const agreementId = `550e8400-e29b-41d4-a716-44665544010${disputeAgreementSequence}`;
    supabase.tables.agreements.push({
      ...supabase.tables.agreements[0],
      id: agreementId,
      contract_id: `contract-dispute-${disputeAgreementSequence}`,
      status: 'active',
    });
    supabase.tables.agreement_participants.push(
      {
        id: `participant-dispute-payer-${disputeAgreementSequence}`,
        agreement_id: agreementId,
        wallet_address: WALLET,
        role: 'payer',
      },
      {
        id: `participant-dispute-payee-${disputeAgreementSequence}`,
        agreement_id: agreementId,
        wallet_address: SECOND_WALLET,
        role: 'payee',
      },
    );

    const opened = await request(app.getHttpServer())
      .post('/v1/disputes')
      .set(auth())
      .send({
        agreement_id: agreementId,
        opened_by: WALLET,
        reason: `Dispute ${Date.now()} ${Math.random()}`,
      })
      .expect(201);
    const disputeId = opened.body.dispute.id;

    await request(app.getHttpServer())
      .patch(`/v1/disputes/${disputeId}/assign-resolver`)
      .set(auth())
      .send({ resolver_wallet: RESOLVER_WALLET })
      .expect(200);

    return disputeId;
  }

  describe('Agreements Module Integration Suite', () => {
    it('POST /agreements - success', async () => {
      await request(app.getHttpServer())
        .post('/v1/agreements')
        .set(auth())
        .send({
          title: 'Test POST agreements',
          amount: '500.00',
          asset: 'USDC',
          created_by: WALLET,
          participants: [
            { wallet_address: WALLET, role: 'payer' },
            { wallet_address: SECOND_WALLET, role: 'payee' },
          ],
        })
        .expect(201)
        .expect(({ body }) => {
          expect(body.error).toBeNull();
          expect(body.agreement).toBeDefined();
        });
    });

    it('POST /agreements - errors (invalid token, mismatched creator)', async () => {
      // 401: Invalid token
      await request(app.getHttpServer())
        .post('/v1/agreements')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          title: 'Test POST agreements',
          amount: '500.00',
          created_by: WALLET,
          participants: [{ wallet_address: WALLET, role: 'payer' }],
        })
        .expect(401);

      // 403: Mismatched creator wallet (other wallet is owned by other user)
      await request(app.getHttpServer())
        .post('/v1/agreements')
        .set(auth())
        .send({
          title: 'Test POST agreements',
          amount: '500.00',
          created_by: OTHER_WALLET,
          participants: [{ wallet_address: OTHER_WALLET, role: 'payer' }],
        })
        .expect(403);
    });

    it('GET /agreements/by-wallet - success', async () => {
      await request(app.getHttpServer())
        .get(`/v1/agreements/by-wallet?wallet=${WALLET}`)
        .set(auth())
        .expect(200)
        .expect(({ body }) => {
          expect(body.error).toBeNull();
          expect(body.agreements).toBeDefined();
        });
    });

    it('GET /agreements/by-wallet - errors (invalid token, forbidden wallet)', async () => {
      // 401: Invalid token
      await request(app.getHttpServer())
        .get(`/v1/agreements/by-wallet?wallet=${WALLET}`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      // 403: Forbidden wallet
      await request(app.getHttpServer())
        .get(`/v1/agreements/by-wallet?wallet=${OTHER_WALLET}`)
        .set(auth())
        .expect(403);
    });

    it('GET /agreements/:id - success', async () => {
      await request(app.getHttpServer())
        .get(`/v1/agreements/${AGREEMENT_ID}`)
        .set(auth())
        .expect(200)
        .expect(({ body }) => {
          expect(body.error).toBeNull();
          expect(body.agreement.id).toBe(AGREEMENT_ID);
        });
    });

    it('GET /agreements/:id - errors (invalid token, not found, unauthorized)', async () => {
      // 401: Invalid token
      await request(app.getHttpServer())
        .get(`/v1/agreements/${AGREEMENT_ID}`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      // 404: Not found
      const missingId = '550e8400-e29b-41d4-a716-446655449999';
      await request(app.getHttpServer()).get(`/v1/agreements/${missingId}`).set(auth()).expect(404);

      // 403: Mismatched / unauthorized wallet (other user accessing USER_ID's agreement)
      await request(app.getHttpServer())
        .get(`/v1/agreements/${AGREEMENT_ID}`)
        .set(auth(OTHER_USER_ID))
        .expect(403);
    });

    it('PATCH /agreements/:id/link-contract - success and activity log', async () => {
      const contractId = 'new-contract-link-123';
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/link-contract`)
        .set(auth())
        .send({
          contract_id: contractId,
          actor_wallet: WALLET,
        })
        .expect(200)
        .expect(({ body }) => {
          expect(body.success).toBe(true);
        });

      // Verify contract updated in db
      const agreement = supabase.tables.agreements.find((a) => a.id === AGREEMENT_ID);
      expect(agreement?.contract_id).toBe(contractId);

      // Assert activity log entry is created
      const activities = supabase.tables.agreement_activity.filter(
        (act) => act.agreement_id === AGREEMENT_ID && act.action === 'contract_linked',
      );
      expect(activities.length).toBeGreaterThan(0);
      expect(activities[0].details).toMatchObject({ contract_id: contractId });
    });

    it('PATCH /agreements/:id/link-contract - errors', async () => {
      // 401: Invalid token
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/link-contract`)
        .set('Authorization', 'Bearer invalid-token')
        .send({ contract_id: 'c-1', actor_wallet: WALLET })
        .expect(401);

      // 404: Not found
      const missingId = '550e8400-e29b-41d4-a716-446655449999';
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${missingId}/link-contract`)
        .set(auth())
        .send({ contract_id: 'c-1', actor_wallet: WALLET })
        .expect(404);

      // 403: Unauthorized user (OTHER_USER_ID lacks access)
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/link-contract`)
        .set(auth(OTHER_USER_ID))
        .send({ contract_id: 'c-1', actor_wallet: OTHER_WALLET })
        .expect(403);

      // 403: Mismatched actor wallet for USER_ID (actor_wallet is OTHER_WALLET, but token is USER_ID)
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/link-contract`)
        .set(auth())
        .send({ contract_id: 'c-1', actor_wallet: OTHER_WALLET })
        .expect(403);
    });

    it('PATCH /agreements/:id/status - success and activity log', async () => {
      // Transition from active to in_review
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/status`)
        .set(auth())
        .send({
          status: 'in_review',
          actor_wallet: WALLET,
        })
        .expect(200)
        .expect(({ body }) => {
          expect(body.success).toBe(true);
        });

      // Verify status updated in db
      const agreement = supabase.tables.agreements.find((a) => a.id === AGREEMENT_ID);
      expect(agreement?.status).toBe('in_review');

      // Assert activity log entry is created
      const activities = supabase.tables.agreement_activity.filter(
        (act) => act.agreement_id === AGREEMENT_ID && act.action === 'status_changed_to_in_review',
      );
      expect(activities.length).toBeGreaterThan(0);
      expect(activities[0].details).toMatchObject({ from: 'active', to: 'in_review' });
    });

    it('PATCH /agreements/:id/status - errors', async () => {
      // 401: Invalid token
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/status`)
        .set('Authorization', 'Bearer invalid-token')
        .send({ status: 'completed', actor_wallet: WALLET })
        .expect(401);

      // 404: Not found
      const missingId = '550e8400-e29b-41d4-a716-446655449999';
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${missingId}/status`)
        .set(auth())
        .send({ status: 'completed', actor_wallet: WALLET })
        .expect(404);

      // 403: Unauthorized (OTHER_USER_ID lacks access)
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/status`)
        .set(auth(OTHER_USER_ID))
        .send({ status: 'completed', actor_wallet: OTHER_WALLET })
        .expect(403);

      // 400: Invalid transition (completed status when milestones are not approved)
      // Note: At this point status is 'in_review', but milestone is 'pending'.
      // Trying to transition to completed should fail because milestonesSatisfyCompletion returns false.
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/status`)
        .set(auth())
        .send({ status: 'completed', actor_wallet: WALLET })
        .expect(400);
    });

    it('PATCH /agreements/:id/milestones - success and activity log', async () => {
      // Update milestone 0 status to approved
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/milestones`)
        .set(auth())
        .send({
          milestone_index: 0,
          status: 'approved',
          actor_wallet: WALLET,
          evidence_description: 'Deliverable complete',
        })
        .expect(200)
        .expect(({ body }) => {
          expect(body.success).toBe(true);
        });

      // Verify milestone updated in db
      const agreement = supabase.tables.agreements.find((a) => a.id === AGREEMENT_ID);
      expect(agreement?.milestones[0].status).toBe('approved');
      expect(agreement?.milestones[0].evidence_description).toBe('Deliverable complete');

      // Assert activity log entry is created
      const activities = supabase.tables.agreement_activity.filter(
        (act) => act.agreement_id === AGREEMENT_ID && act.action === 'milestone_approved',
      );
      expect(activities.length).toBeGreaterThan(0);
      expect(activities[0].details).toMatchObject({ milestone_index: 0 });
    });

    it('PATCH /agreements/:id/milestones - errors', async () => {
      // 401: Invalid token
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/milestones`)
        .set('Authorization', 'Bearer invalid-token')
        .send({ milestone_index: 0, status: 'approved', actor_wallet: WALLET })
        .expect(401);

      // 404: Not found
      const missingId = '550e8400-e29b-41d4-a716-446655449999';
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${missingId}/milestones`)
        .set(auth())
        .send({ milestone_index: 0, status: 'approved', actor_wallet: WALLET })
        .expect(404);

      // 403: Mismatched / unauthorized wallet (other user accessing)
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/milestones`)
        .set(auth(OTHER_USER_ID))
        .send({ milestone_index: 0, status: 'approved', actor_wallet: OTHER_WALLET })
        .expect(403);

      // 200 with success: false (invalid milestone index)
      await request(app.getHttpServer())
        .patch(`/v1/agreements/${AGREEMENT_ID}/milestones`)
        .set(auth())
        .send({ milestone_index: 99, status: 'approved', actor_wallet: WALLET })
        .expect(200)
        .expect(({ body }) => {
          expect(body.success).toBe(false);
          expect(body.error).toBe('Invalid milestone index');
        });
    });

    it('GET /agreements/:id/activity - success', async () => {
      // Seed some activity
      supabase.tables.agreement_activity.push({
        id: 'act-test-1',
        agreement_id: AGREEMENT_ID,
        actor_wallet: WALLET,
        action: 'status_changed_to_active',
        details: {},
        created_at: '2026-07-21T00:00:00.000Z',
      });

      await request(app.getHttpServer())
        .get(`/v1/agreements/${AGREEMENT_ID}/activity`)
        .set(auth())
        .expect(200)
        .expect(({ body }) => {
          expect(body.error).toBeNull();
          expect(body.activities).toBeDefined();
          expect(body.activities.length).toBeGreaterThan(0);
        });
    });

    it('GET /agreements/:id/activity - errors', async () => {
      // 401: Invalid token
      await request(app.getHttpServer())
        .get(`/v1/agreements/${AGREEMENT_ID}/activity`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      // 404: Not found
      const missingId = '550e8400-e29b-41d4-a716-446655449999';
      await request(app.getHttpServer())
        .get(`/v1/agreements/${missingId}/activity`)
        .set(auth())
        .expect(404);

      // 403: Unauthorized wallet (other user lacks access)
      await request(app.getHttpServer())
        .get(`/v1/agreements/${AGREEMENT_ID}/activity`)
        .set(auth(OTHER_USER_ID))
        .expect(403);
    });

    it('GET /agreements/by-contract/:contractId - success', async () => {
      await request(app.getHttpServer())
        .get(`/v1/agreements/by-contract/${CONTRACT_ID}`)
        .set(auth())
        .expect(200)
        .expect(({ body }) => {
          expect(body.error).toBeNull();
          expect(body.agreement.contract_id).toBe(CONTRACT_ID);
        });
    });

    it('GET /agreements/by-contract/:contractId - errors', async () => {
      // 401: Invalid token
      await request(app.getHttpServer())
        .get(`/v1/agreements/by-contract/${CONTRACT_ID}`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      // 200 with null agreement (not found)
      await request(app.getHttpServer())
        .get('/v1/agreements/by-contract/non-existent-contract')
        .set(auth())
        .expect(200)
        .expect(({ body }) => {
          expect(body.agreement).toBeNull();
          expect(body.error).toContain('Ningún acuerdo tiene contract_id igual a este valor');
        });

      // 403: Unauthorized (other user accessing)
      await request(app.getHttpServer())
        .get(`/v1/agreements/by-contract/${CONTRACT_ID}`)
        .set(auth(OTHER_USER_ID))
        .expect(403);
    });
  });
});

function collectFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    return statSync(fullPath).isDirectory() ? collectFiles(fullPath) : [fullPath];
  });
}
