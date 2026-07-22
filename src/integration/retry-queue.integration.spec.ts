import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../supabase/supabase.service';
import { RetryQueueController } from '../retry-queue/retry-queue.controller';
import { RetryQueueService } from '../retry-queue/retry-queue.service';
import { RetryJobStatus, RetryJobType } from '../retry-queue/retry-queue.types';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';

// ---------------------------------------------------------------------------
// Generic in-memory Supabase fixture (multiple tables: retry_jobs, auth_users,
// profiles) so this suite exercises RetryQueueService end-to-end — enqueue,
// poll, admin auth check, HTTP layer — without a live Supabase project.
// Mirrors the InMemorySupabase fixture in migrated-flows.integration.spec.ts,
// extended with `lte` (needed for the due-jobs / stale-processing polling
// queries) since that fixture doesn't support it.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
type Filter = { key: string; op: 'eq' | 'lte' | 'neq'; value: any };

class FakeSupabaseStore {
  tables: Record<string, Row[]> = { retry_jobs: [], auth_users: [], profiles: [] };
  private seq = 1;

  getClient() {
    return { from: (table: string) => new FakeBuilder(this, table) };
  }

  reset() {
    this.tables = { retry_jobs: [], auth_users: [], profiles: [] };
    this.seq = 1;
  }

  insert(table: string, row: Row) {
    if (row.idempotency_key) {
      const duplicate = (this.tables[table] ?? []).find(
        (r) => r.idempotency_key === row.idempotency_key,
      );
      if (duplicate) {
        return {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        };
      }
    }
    const id = row.id ?? `${table}-${this.seq++}`;
    const now = new Date().toISOString();
    const full: Row = {
      created_at: now,
      updated_at: now,
      completed_at: null,
      last_error: null,
      ...row,
      id,
    };
    this.tables[table] = [...(this.tables[table] ?? []), full];
    return { data: { ...full }, error: null };
  }

  update(table: string, filters: Filter[], updates: Row) {
    // A guarded UPDATE (e.g. `.eq(...).neq('status', targetStatus)`) matching zero rows
    // is not a DB error in real Supabase — it's just an empty result.
    let updated: Row | null = null;
    this.tables[table] = (this.tables[table] ?? []).map((row) => {
      if (this.matches(row, filters)) {
        updated = { ...row, ...updates };
        return updated;
      }
      return row;
    });
    return { data: updated, error: null };
  }

  select(table: string, filters: Filter[]) {
    return (this.tables[table] ?? []).filter((row) => this.matches(row, filters));
  }

  private matches(row: Row, filters: Filter[]) {
    return filters.every((f) => {
      if (f.op === 'eq') return row[f.key] === f.value;
      if (f.op === 'neq') return row[f.key] !== f.value;
      return row[f.key] <= f.value;
    });
  }
}

class FakeBuilder implements PromiseLike<{ data: any; error: any }> {
  private mode: 'select' | 'insert' | 'update' = 'select';
  private filters: Filter[] = [];
  private payload: Row | undefined;
  private wantsSingle = false;

  constructor(
    private readonly store: FakeSupabaseStore,
    private readonly table: string,
  ) {}

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

  select(_columns?: string) {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, op: 'eq', value });
    return this;
  }

  neq(key: string, value: unknown) {
    this.filters.push({ key, op: 'neq', value });
    return this;
  }

  lte(key: string, value: unknown) {
    this.filters.push({ key, op: 'lte', value });
    return this;
  }

  order(_key?: string, _opts?: unknown) {
    return this;
  }

  limit(_n?: number) {
    return this;
  }

  single() {
    this.wantsSingle = true;
    return this;
  }

  maybeSingle() {
    this.wantsSingle = true;
    return this;
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }

  private exec(): { data: any; error: any } {
    if (this.mode === 'insert') return this.store.insert(this.table, this.payload!);
    if (this.mode === 'update') return this.store.update(this.table, this.filters, this.payload!);
    const rows = this.store.select(this.table, this.filters);
    if (this.wantsSingle) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

// ---------------------------------------------------------------------------

const JWT_SECRET = 'dev-insecure-change-me';
const ADMIN_USER_ID = 'admin-user-1';
const ADMIN_WALLET = 'GADMINWALLET0000000000000000000000000000000000000000000';
const PLAIN_USER_ID = 'plain-user-1';
const PLAIN_WALLET = 'GPLAINWALLET0000000000000000000000000000000000000000000';

describe('retry queue (integration)', () => {
  let app: INestApplication;
  let store: FakeSupabaseStore;
  let retryQueueService: RetryQueueService;

  const testConfig: Record<string, string> = {
    RETRY_QUEUE_MAX_ATTEMPTS: '3',
    RETRY_QUEUE_BASE_DELAY_MS: '0',
    RETRY_QUEUE_MAX_DELAY_MS: '0',
    // Large on purpose: tests drive polling manually via processDueJobs(), the
    // automatic interval only needs to not fire mid-assertion.
    RETRY_QUEUE_POLL_INTERVAL_MS: '3600000',
    RETRY_QUEUE_CONCURRENCY: '5',
    RETRY_QUEUE_STALE_PROCESSING_MS: '60000',
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    store = new FakeSupabaseStore();

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [RetryQueueController],
      providers: [
        RetryQueueService,
        { provide: SupabaseService, useValue: store },
        {
          provide: ConfigService,
          useValue: { get: (key: string, def?: string) => testConfig[key] ?? def },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    retryQueueService = moduleRef.get(RetryQueueService);
  });

  beforeEach(() => {
    store.reset();
    store.tables.auth_users = [
      { id: ADMIN_USER_ID, wallet_public_key: ADMIN_WALLET },
      { id: PLAIN_USER_ID, wallet_public_key: PLAIN_WALLET },
    ];
    store.tables.profiles = [
      { id: 'profile-admin', wallet_address: ADMIN_WALLET, role: 'admin' },
      { id: 'profile-plain', wallet_address: PLAIN_WALLET, role: 'user' },
    ];
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenFor = (sub: string) =>
    jwt.sign({ sub }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
  const authHeader = (sub: string) => ({ Authorization: `Bearer ${tokenFor(sub)}` });

  it('retries a mocked failing Trustless Work call and recovers end-to-end', async () => {
    retryQueueService.registerHandler(RetryJobType.CONTRACT_RETRIEVAL, async (payload: any) => {
      const res = await fetch(`https://trustless-work.test/escrow/${payload.contractId}`);
      if (!res.ok) throw new Error(`TW request failed with status ${res.status}`);
      return res.json();
    });

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ contractId: 'c-99', status: 'active' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const job = await retryQueueService.enqueue(
      RetryJobType.CONTRACT_RETRIEVAL,
      { contractId: 'c-99' },
      'tw-contract-retrieval-c-99',
    );

    // Drive the poll loop directly instead of waiting on the real setInterval.
    await retryQueueService.processDueJobs(); // attempt 1: fails
    await retryQueueService.processDueJobs(); // attempt 2: fails
    await retryQueueService.processDueJobs(); // attempt 3: succeeds

    const finalJob = await retryQueueService.getJob(job.id);
    expect(finalJob?.status).toBe(RetryJobStatus.SUCCEEDED);
    expect(finalJob?.attempts).toBe(3);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('blocks a duplicate enqueue with the same idempotency key from executing twice', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    retryQueueService.registerHandler(RetryJobType.STATUS_SYNC, handler);

    const first = await retryQueueService.enqueue(RetryJobType.STATUS_SYNC, { a: 1 }, 'sync-dup-1');
    const second = await retryQueueService.enqueue(
      RetryJobType.STATUS_SYNC,
      { a: 1 },
      'sync-dup-1',
    );
    expect(second.id).toBe(first.id);
    expect(store.tables.retry_jobs).toHaveLength(1);

    await retryQueueService.processDueJobs();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lets an admin manually retry a failed job exactly once via the HTTP endpoint', async () => {
    const handler = jest.fn().mockRejectedValueOnce(new Error('temporarily unavailable'));
    retryQueueService.registerHandler(RetryJobType.MILESTONE_UPDATE, handler);

    const job = await retryQueueService.enqueue(
      RetryJobType.MILESTONE_UPDATE,
      { milestoneIndex: 0 },
      'milestone-retry-1',
      { maxAttempts: 1 },
    );
    await retryQueueService.processDueJobs();
    const failed = await retryQueueService.getJob(job.id);
    expect(failed?.status).toBe(RetryJobStatus.FAILED);

    handler.mockResolvedValueOnce(undefined);

    await request(app.getHttpServer())
      .post(`/v1/retry-queue/${job.id}/retry`)
      .set(authHeader(ADMIN_USER_ID))
      .expect(201)
      .expect(({ body }) => {
        expect(body.job.status).toBe(RetryJobStatus.SUCCEEDED);
      });

    expect(handler).toHaveBeenCalledTimes(2); // 1 automatic failure + 1 manual retry
  });

  it('rejects manual retry from a non-admin user with 403', async () => {
    retryQueueService.registerHandler(
      RetryJobType.PAYMENT_EXECUTION,
      jest.fn().mockRejectedValue(new Error('down')),
    );
    const job = await retryQueueService.enqueue(
      RetryJobType.PAYMENT_EXECUTION,
      {},
      'payment-forbidden-1',
      { maxAttempts: 1 },
    );
    await retryQueueService.processDueJobs();

    await request(app.getHttpServer())
      .post(`/v1/retry-queue/${job.id}/retry`)
      .set(authHeader(PLAIN_USER_ID))
      .expect(403);
  });

  it('lets an admin list retry jobs filtered by status', async () => {
    retryQueueService.registerHandler(
      RetryJobType.STATUS_SYNC,
      jest.fn().mockResolvedValue(undefined),
    );
    await retryQueueService.enqueue(RetryJobType.STATUS_SYNC, {}, 'listed-job-1');
    await retryQueueService.processDueJobs();

    await request(app.getHttpServer())
      .get('/v1/retry-queue?status=succeeded')
      .set(authHeader(ADMIN_USER_ID))
      .expect(200)
      .expect(({ body }) => {
        expect(body.jobs).toEqual(
          expect.arrayContaining([expect.objectContaining({ idempotency_key: 'listed-job-1' })]),
        );
      });
  });
});

describe('retry queue (integration) — WebhooksService reuses the shared queue', () => {
  it('enqueues an inbound TW webhook and applies it to the agreement once the poller runs it', async () => {
    const localStore = new FakeSupabaseStore();
    localStore.tables.agreements = [
      {
        id: 'agr-1',
        contract_id: 'c-100',
        status: 'created',
        title: 'Test',
        amount: '10',
        asset: 'USDC',
      },
    ];
    localStore.tables.agreement_activity = [];

    const localConfig: Record<string, string> = {
      RETRY_QUEUE_MAX_ATTEMPTS: '3',
      RETRY_QUEUE_BASE_DELAY_MS: '0',
      RETRY_QUEUE_MAX_DELAY_MS: '0',
      RETRY_QUEUE_POLL_INTERVAL_MS: '3600000',
      RETRY_QUEUE_CONCURRENCY: '5',
      RETRY_QUEUE_STALE_PROCESSING_MS: '60000',
    };
    const localRetryQueue = new RetryQueueService(
      localStore as unknown as SupabaseService,
      { get: (key: string, def?: string) => localConfig[key] ?? def } as unknown as ConfigService,
    );

    const emit = jest.fn();
    const webhooksService = new WebhooksService(
      localStore as unknown as SupabaseService,
      { emit } as unknown as EventEmitter2,
      { notifyDisputeOpened: jest.fn() } as unknown as NotificationsService,
      { get: () => 'test-secret' } as unknown as ConfigService,
      localRetryQueue,
    );
    webhooksService.onModuleInit();

    const result = await webhooksService.handleEvent({
      event: 'escrow.funded',
      contractId: 'c-100',
    });
    expect(result).toEqual({ handled: true });

    // Enqueued but not yet processed — the poller hasn't run.
    expect(localStore.tables.agreements[0].status).toBe('created');

    await localRetryQueue.processDueJobs();

    expect(localStore.tables.agreements[0].status).toBe('funded');
    expect(emit).toHaveBeenCalledWith(
      'agreement.funded',
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
  });
});
