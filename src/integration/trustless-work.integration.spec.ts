import 'reflect-metadata';
import * as crypto from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AgreementsController } from '../agreements/agreements.controller';
import { AgreementsService } from '../agreements/agreements.service';
import { AuthModule } from '../auth/auth.module';
import { EscrowsController } from '../internal-trustless/escrows.controller';
import { relayToTrustless } from '../internal-trustless/trustless-relay.helper';
import { NotificationsService } from '../notifications/notifications.service';
import { SupabaseService } from '../supabase/supabase.service';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { WebhooksService } from '../webhooks/webhooks.service';

jest.mock('../internal-trustless/trustless-relay.helper', () => ({
  relayToTrustless: jest.fn(),
}));

type Row = Record<string, any>;
type Filter = { key: string; op: 'eq' | 'neq' | 'in'; value: any };
type QueryResult = {
  data: any;
  error: { message: string; code?: string } | null;
};

const JWT_SECRET = 'trustless-work-integration-jwt-secret';
const WEBHOOK_SECRET = 'trustless-work-integration-webhook-secret';
const USER_ID = 'tw-integration-user';
const WALLET = 'GTWINTEGRATIONWALLET000000000000000000000000000000000000';
const SECOND_WALLET = 'GTWINTEGRATIONPAYEE00000000000000000000000000000000000';
const SEEDED_AGREEMENT_ID = 'tw-agreement-seeded';
const SEEDED_CONTRACT_ID = 'tw-contract-seeded';
const LIFECYCLE_CONTRACT_ID = 'tw-contract-lifecycle';

class QueryBuilder implements PromiseLike<QueryResult> {
  private filters: Filter[] = [];
  private selected = false;
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: Row | Row[] | undefined;
  private resultMode: 'many' | 'single' | 'maybeSingle' = 'many';
  private orderBy: { key: string; ascending: boolean } | undefined;
  private rowLimit: number | undefined;

  constructor(
    private readonly db: InMemorySupabase,
    private readonly table: string,
  ) {}

  select(_columns = '*') {
    this.selected = true;
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

  limit(count: number) {
    this.rowLimit = count;
    return this;
  }

  order(key: string, options?: { ascending?: boolean }) {
    this.orderBy = { key, ascending: options?.ascending ?? true };
    return this;
  }

  insert(payload: Row | Row[]) {
    this.mode = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.mode = 'update';
    this.payload = payload;
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

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    this.db.recordOperation(this.table, this.mode);
    const forcedError = this.db.consumeFailure(this.table, this.mode);
    if (forcedError) return { data: this.emptyData(), error: { message: forcedError } };

    if (this.mode === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const inserted = rows.map((row) => this.db.insert(this.table, row));
      return { data: this.formatRows(inserted, this.selected), error: null };
    }

    if (this.mode === 'update') {
      const updated = this.db.update(this.table, this.filters, this.payload as Row);
      return { data: this.formatRows(updated, this.selected), error: null };
    }

    let rows = this.db.select(this.table, this.filters);
    if (this.orderBy) {
      const { key, ascending } = this.orderBy;
      rows = rows.sort((left, right) => {
        if (left[key] === right[key]) return 0;
        const result = left[key] > right[key] ? 1 : -1;
        return ascending ? result : -result;
      });
    }
    if (this.rowLimit !== undefined) rows = rows.slice(0, this.rowLimit);
    return { data: this.formatRows(rows, true), error: null };
  }

  private formatRows(rows: Row[], returnData: boolean) {
    if (!returnData) return null;
    if (this.resultMode === 'single' || this.resultMode === 'maybeSingle') {
      return rows[0] ?? null;
    }
    return rows;
  }

  private emptyData() {
    return this.resultMode === 'many' ? [] : null;
  }
}

class InMemorySupabase {
  readonly tables: Record<string, Row[]> = {};
  private failures: Array<{ table: string; mode: string; message: string }> = [];
  private operations = new Map<string, number>();
  private sequence = 1;

  constructor() {
    this.reset();
  }

  reset() {
    this.failures = [];
    this.operations.clear();
    this.sequence = 1;
    this.tables.auth_users = [{ id: USER_ID, wallet_public_key: WALLET }];
    this.tables.profiles = [
      { id: 'tw-profile-creator', wallet_address: WALLET },
      { id: 'tw-profile-payee', wallet_address: SECOND_WALLET },
    ];
    this.tables.agreements = [
      {
        id: SEEDED_AGREEMENT_ID,
        contract_id: SEEDED_CONTRACT_ID,
        title: 'Trustless Work seeded agreement',
        description: 'Webhook integration fixture',
        amount: '100.00',
        asset: 'USDC',
        status: 'pending',
        agreement_type: 'multi',
        created_by: WALLET,
        milestones: [
          { description: 'Design', amount: '40.00', status: 'pending' },
          { description: 'Delivery', amount: '60.00', status: 'pending' },
        ],
        metadata: {},
      },
    ];
    this.tables.agreement_participants = [
      {
        id: 'tw-participant-creator',
        agreement_id: SEEDED_AGREEMENT_ID,
        wallet_address: WALLET,
        role: 'payer',
      },
      {
        id: 'tw-participant-payee',
        agreement_id: SEEDED_AGREEMENT_ID,
        wallet_address: SECOND_WALLET,
        role: 'payee',
      },
    ];
    this.tables.agreement_activity = [];
  }

  getClient() {
    return { from: (table: string) => new QueryBuilder(this, table) };
  }

  failNext(table: string, mode: string, message: string, times = 1) {
    for (let index = 0; index < times; index++) {
      this.failures.push({ table, mode, message });
    }
  }

  consumeFailure(table: string, mode: string) {
    const index = this.failures.findIndex(
      (failure) => failure.table === table && failure.mode === mode,
    );
    if (index === -1) return null;
    const [failure] = this.failures.splice(index, 1);
    return failure.message;
  }

  recordOperation(table: string, mode: string) {
    const key = `${table}:${mode}`;
    this.operations.set(key, (this.operations.get(key) ?? 0) + 1);
  }

  operationCount(table: string, mode: string) {
    return this.operations.get(`${table}:${mode}`) ?? 0;
  }

  insert(table: string, row: Row) {
    const inserted = {
      id: row.id ?? `${table}-${this.sequence++}`,
      created_at: row.created_at ?? '2026-07-22T00:00:00.000Z',
      ...this.clone(row),
    };
    this.tables[table] = [...(this.tables[table] ?? []), inserted];
    return this.clone(inserted);
  }

  update(table: string, filters: Filter[], payload: Row) {
    const updated: Row[] = [];
    this.tables[table] = (this.tables[table] ?? []).map((row) => {
      if (!this.matches(row, filters)) return row;
      const next = { ...row, ...this.clone(payload) };
      updated.push(this.clone(next));
      return next;
    });
    return updated;
  }

  select(table: string, filters: Filter[]) {
    return (this.tables[table] ?? [])
      .filter((row) => this.matches(row, filters))
      .map((row) => this.clone(row));
  }

  private matches(row: Row, filters: Filter[]) {
    return filters.every((filter) => {
      if (filter.op === 'eq') return row[filter.key] === filter.value;
      if (filter.op === 'neq') return row[filter.key] !== filter.value;
      return filter.value.includes(row[filter.key]);
    });
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}

describe('Trustless Work end-to-end integration', () => {
  let app: INestApplication;
  let supabase: InMemorySupabase;
  let webhooksService: WebhooksService;
  const eventEmitter = { emit: jest.fn() };
  const notifications = { notifyDisputeOpened: jest.fn().mockResolvedValue(undefined) };
  const relayMock = jest.mocked(relayToTrustless);

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    supabase = new InMemorySupabase();

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [AgreementsController, EscrowsController, WebhooksController],
      providers: [
        AgreementsService,
        WebhooksService,
        { provide: SupabaseService, useValue: supabase },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) =>
              key === 'TRUSTLESS_WORK_WEBHOOK_SECRET' ? WEBHOOK_SECRET : defaultValue,
            ),
          },
        },
      ],
    }).compile();

    webhooksService = moduleRef.get(WebhooksService);
    (webhooksService as unknown as { baseRetryDelay: number }).baseRetryDelay = 1;

    app = moduleRef.createNestApplication({ rawBody: true });
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
    eventEmitter.emit.mockClear();
    notifications.notifyDisputeOpened.mockClear();
    relayMock.mockReset();
    relayMock.mockResolvedValue({
      status: 200,
      data: { unsignedTransaction: 'AAAA-test-unsigned-xdr' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const token = () =>
    jwt.sign({ sub: USER_ID, email: 'tw-integration@example.com' }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  function signatureFor(rawBody: string, secret = WEBHOOK_SECRET) {
    return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  }

  function postWebhook(payload: Record<string, unknown>, signature?: string) {
    const rawBody = JSON.stringify(payload);
    return request(app.getHttpServer())
      .post('/v1/webhooks/trustless-work')
      .set('Content-Type', 'application/json')
      .set('x-trustless-signature', signature ?? signatureFor(rawBody))
      .send(rawBody);
  }

  it('runs create -> single-release escrow write -> link -> funded -> released lifecycle', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/v1/agreements')
      .set(auth())
      .send({
        title: 'TW lifecycle agreement',
        description: 'End-to-end lifecycle coverage',
        amount: '125.00',
        asset: 'USDC',
        agreement_type: 'single',
        milestones: [{ description: 'Complete delivery', amount: '125.00', status: 'pending' }],
        created_by: WALLET,
        participants: [
          { wallet_address: WALLET, role: 'payer' },
          { wallet_address: SECOND_WALLET, role: 'payee' },
        ],
      })
      .expect(201);

    const agreementId = createResponse.body.agreement.id as string;

    await request(app.getHttpServer())
      .post('/v1/escrows/create')
      .set(auth())
      .send({
        title: 'TW lifecycle agreement',
        description: 'End-to-end lifecycle coverage',
        amount: '125.00',
        platformFee: '3',
        signer: WALLET,
        serviceType: 'single-release',
        roles: {
          approver: WALLET,
          serviceProvider: SECOND_WALLET,
          releaseSigner: WALLET,
          receiver: SECOND_WALLET,
        },
        milestones: [{ description: 'Complete delivery' }],
      })
      .expect(200)
      .expect({ unsignedTransaction: 'AAAA-test-unsigned-xdr' });

    expect(relayMock).toHaveBeenCalledWith(
      'POST',
      'deployer/single-release',
      undefined,
      expect.objectContaining({
        title: 'TW lifecycle agreement',
        amount: 125,
        roles: expect.objectContaining({ receiver: SECOND_WALLET }),
        milestones: [{ description: 'Complete delivery' }],
      }),
    );

    await request(app.getHttpServer())
      .patch(`/v1/agreements/${agreementId}/link-contract`)
      .set(auth())
      .send({ contract_id: LIFECYCLE_CONTRACT_ID, actor_wallet: WALLET })
      .expect(200)
      .expect({ success: true, error: null });

    await request(app.getHttpServer())
      .get(`/v1/agreements/by-contract/${LIFECYCLE_CONTRACT_ID}`)
      .set(auth())
      .expect(200)
      .expect(({ body }) => {
        expect(body.agreement).toMatchObject({
          id: agreementId,
          contract_id: LIFECYCLE_CONTRACT_ID,
          status: 'pending',
        });
      });

    await postWebhook({ event: 'escrow.funded', contractId: LIFECYCLE_CONTRACT_ID })
      .expect(200)
      .expect({ ok: true });

    await request(app.getHttpServer())
      .get(`/v1/agreements/by-contract/${LIFECYCLE_CONTRACT_ID}`)
      .set(auth())
      .expect(200)
      .expect(({ body }) => expect(body.agreement.status).toBe('funded'));

    await postWebhook({ event: 'escrow.released', contractId: LIFECYCLE_CONTRACT_ID })
      .expect(200)
      .expect({ ok: true });

    await request(app.getHttpServer())
      .get(`/v1/agreements/by-contract/${LIFECYCLE_CONTRACT_ID}`)
      .set(auth())
      .expect(200)
      .expect(({ body }) => expect(body.agreement.status).toBe('completed'));

    const actions = supabase.tables.agreement_activity
      .filter((activity) => activity.agreement_id === agreementId)
      .map((activity) => activity.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'created',
        'contract_linked',
        'webhook_status_changed_to_funded',
        'webhook_status_changed_to_completed',
      ]),
    );
  });

  it('routes multi-release agreement creation through deployer/multi-release', async () => {
    await request(app.getHttpServer())
      .post('/v1/escrows/create')
      .set(auth())
      .send({
        title: 'Multi-release agreement',
        description: 'Two delivery phases',
        amount: '100.00',
        platformFee: '2.5',
        signer: WALLET,
        serviceType: 'multi-release',
        roles: {
          approver: WALLET,
          serviceProvider: SECOND_WALLET,
          releaseSigner: WALLET,
        },
        milestones: [
          { description: 'Design', amount: '40.00', status: 'pending' },
          { description: 'Delivery', amount: '60.00', status: 'pending' },
        ],
      })
      .expect(200);

    expect(relayMock).toHaveBeenCalledWith(
      'POST',
      'deployer/multi-release',
      undefined,
      expect.objectContaining({
        title: 'Multi-release agreement',
        milestones: [
          { description: 'Design', amount: 40, status: 'pending', receiver: WALLET },
          { description: 'Delivery', amount: 60, status: 'pending', receiver: WALLET },
        ],
      }),
    );
    expect(relayMock.mock.calls[0][3]).not.toHaveProperty('amount');
  });

  it.each([
    ['escrow.funded', 'funded'],
    ['escrow.released', 'completed'],
    ['escrow.disputed', 'disputed'],
    ['dispute.created', 'disputed'],
    ['contract.completed', 'completed'],
    ['contract.cancelled', 'cancelled'],
  ])('%s synchronizes the agreement to %s and logs the transition', async (event, status) => {
    await postWebhook({ event, contractId: SEEDED_CONTRACT_ID }).expect(200).expect({ ok: true });

    await request(app.getHttpServer())
      .get(`/v1/agreements/by-contract/${SEEDED_CONTRACT_ID}`)
      .set(auth())
      .expect(200)
      .expect(({ body }) => expect(body.agreement.status).toBe(status));

    expect(supabase.tables.agreement_activity).toEqual([
      expect.objectContaining({
        agreement_id: SEEDED_AGREEMENT_ID,
        actor_wallet: 'trustless-work-webhook',
        action: `webhook_status_changed_to_${status}`,
        details: expect.objectContaining({ event, contractId: SEEDED_CONTRACT_ID }),
      }),
    ]);
  });

  it.each(['agreement.milestone_updated', 'escrow.milestone_updated'])(
    '%s synchronizes milestone data and logs the update',
    async (event) => {
      await postWebhook({
        event,
        contractId: SEEDED_CONTRACT_ID,
        milestone: { index: 1, status: 'approved', description: 'Delivery accepted' },
      })
        .expect(200)
        .expect({ ok: true });

      await request(app.getHttpServer())
        .get(`/v1/agreements/by-contract/${SEEDED_CONTRACT_ID}`)
        .set(auth())
        .expect(200)
        .expect(({ body }) => {
          expect(body.agreement.milestones[1]).toEqual({
            description: 'Delivery accepted',
            amount: '60.00',
            status: 'approved',
          });
        });

      expect(supabase.tables.agreement_activity).toEqual([
        expect.objectContaining({
          agreement_id: SEEDED_AGREEMENT_ID,
          action: 'webhook_milestone_updated',
          details: expect.objectContaining({ event, milestone_index: 1 }),
        }),
      ]);
    },
  );

  it('accepts a valid HMAC and rejects an invalid HMAC before synchronization', async () => {
    const payload = { event: 'agreement.created', contractId: SEEDED_CONTRACT_ID };

    await postWebhook(payload).expect(200).expect({ ok: true });
    expect(supabase.tables.agreement_activity).toHaveLength(1);

    await postWebhook(payload, signatureFor(JSON.stringify(payload), 'wrong-secret')).expect(401);
    expect(supabase.tables.agreement_activity).toHaveLength(1);
  });

  it('recovers after two transient provider failures through withRetry', async () => {
    supabase.failNext('agreements', 'update', 'transient provider timeout', 2);

    await postWebhook({ event: 'escrow.funded', contractId: SEEDED_CONTRACT_ID })
      .expect(200)
      .expect({ ok: true });

    expect(supabase.operationCount('agreements', 'update')).toBe(3);
    expect(supabase.tables.agreements[0].status).toBe('funded');
  });

  it('reports processing_failed after persistent provider failures exhaust retries', async () => {
    supabase.failNext('agreements', 'update', 'persistent provider outage', 4);

    await postWebhook({ event: 'escrow.funded', contractId: SEEDED_CONTRACT_ID })
      .expect(200)
      .expect({ ok: false, reason: 'processing_failed' });

    expect(supabase.operationCount('agreements', 'update')).toBe(4);
    expect(supabase.tables.agreements[0].status).toBe('pending');
  });

  it('withRetry surfaces the original error after exhausting all attempts', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('network unavailable'));
    const retryable = webhooksService as unknown as {
      withRetry<T>(fn: () => Promise<T>, label: string): Promise<T>;
    };

    await expect(retryable.withRetry(operation, 'provider-call')).rejects.toThrow(
      'network unavailable',
    );
    expect(operation).toHaveBeenCalledTimes(4);
  });

  it('treats a duplicate webhook as idempotent without a second activity or notification', async () => {
    const payload = { event: 'escrow.funded', contractId: SEEDED_CONTRACT_ID };

    await postWebhook(payload).expect(200).expect({ ok: true });
    await postWebhook(payload).expect(200).expect({ ok: true });

    expect(supabase.tables.agreements[0].status).toBe('funded');
    expect(
      supabase.tables.agreement_activity.filter(
        (activity) => activity.action === 'webhook_status_changed_to_funded',
      ),
    ).toHaveLength(1);
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'agreement.funded',
      expect.objectContaining({ agreementId: SEEDED_AGREEMENT_ID }),
    );
  });
});
