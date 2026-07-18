import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { VerificationService } from '../verification/verification.service';
import { VerificationProviderFactory } from '../verification/providers/provider-factory';
import { VerificationController } from '../verification/verification.controller';
import {
  IVerificationProvider,
  ProviderConfig,
} from '../verification/providers/verification.provider';
import {
  VerificationStatus,
  VerificationType,
  VerificationProvider,
} from '../verification/dto/verification.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthModule } from '../auth/auth.module';
import { WalletsService } from '../wallets/wallets.service';

// Set environment variables for Supabase (needed for tests)
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

// Mock stellar-sdk to avoid ES module issues
jest.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromPublicKey: () => ({ verify: () => true }),
  },
}));

type Row = Record<string, any>;
type QueryResult = { data?: any; error: { message: string; code?: string } | null; count?: number };

const JWT_SECRET = 'dev-insecure-change-me';
const USER_ID = 'staging-user-1';
const WALLET = 'GSTAGINGUSERWALLET000000000000000000000000000000000000000';

class InMemorySupabase {
  readonly tables: Record<string, Row[]> = {};
  private sequence = 1;

  constructor() {
    this.reset();
  }

  reset() {
    this.sequence = 1;
    this.tables.verison_sessions = [];
    this.tables.user_wallets = [];
    this.tables.agreement_participants = [];
  }

  getClient() {
    return {
      from: (table: string) => new QueryBuilder(this, table),
    };
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

  private project(_table: string, row: Row, _columns?: string) {
    return { ...row };
  }
}

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
}

class StubProvider implements IVerificationProvider {
  readonly name = VerificationProvider.MOCK;
  readonly supportedTypes: VerificationType[] = [VerificationType.KYC, VerificationType.KYB];

  private shouldFail = false;
  private failOn: 'create' | 'getStatus' | 'handleWebhook' = 'create';
  private delayMs = 0;
  private config: ProviderConfig = {};

  // Response templates that can be customized
  private createSessionResponse: {
    provider_session_id: string;
    provider_url?: string;
    expires_at: string;
  } = {
    provider_session_id: `mock-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    provider_url: `https://mock-verification.test/session/${Math.random().toString(36).slice(2, 9)}`,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
  };

  private getStatusResponse: {
    status: VerificationStatus;
    result?: Record<string, unknown>;
    error?: { code: string; message: string };
  } = {
    status: VerificationStatus.COMPLETED,
  };

  private handleWebhookResponse: {
    status: VerificationStatus;
  } = {
    status: VerificationStatus.COMPLETED,
  };

  configure(config: {
    shouldFail?: boolean;
    failOn?: 'create' | 'getStatus' | 'handleWebhook';
    createSessionResponse?: {
      provider_session_id: string;
      provider_url?: string;
      expires_at: string;
    };
    getStatusResponse?: {
      status: VerificationStatus;
      result?: Record<string, unknown>;
      error?: { code: string; message: string };
    };
    handleWebhookResponse?: {
      status: VerificationStatus;
    };
  }): this {
    if (config.shouldFail !== undefined) {
      this.shouldFail = config.shouldFail;
    }
    if (config.failOn) {
      this.failOn = config.failOn;
    }
    if (config.createSessionResponse) {
      this.createSessionResponse = config.createSessionResponse;
    }
    if (config.getStatusResponse) {
      this.getStatusResponse = {
        ...this.getStatusResponse,
        ...(config.getStatusResponse as any),
      };
    }
    if (config.handleWebhookResponse) {
      this.handleWebhookResponse = {
        ...this.handleWebhookResponse,
        ...(config.handleWebhookResponse as any),
      };
    }
    return this;
  }

  async createSession(
    _subject: any,
    _type: VerificationType,
  ): Promise<{
    provider_session_id: string;
    provider_url?: string;
    expires_at: string;
  }> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.shouldFail && this.failOn === 'create') {
      throw new Error('MOCK_PROVIDER_ERROR: Failed to create verification session');
    }

    // Return a copy of the template with a fresh session ID
    return {
      ...this.createSessionResponse,
    };
  }

  async getStatus(_sessionId: string): Promise<{
    status: VerificationStatus;
    result?: Record<string, unknown>;
    error?: { code: string; message: string };
  }> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.shouldFail && this.failOn === 'getStatus') {
      throw new Error('MOCK_PROVIDER_ERROR: Failed to get verification status');
    }

    return { ...this.getStatusResponse };
  }

  async handleWebhook(payload: any): Promise<{
    status: VerificationStatus;
    result?: Record<string, unknown>;
    error?: { code: string; message: string };
  }> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.shouldFail && this.failOn === 'handleWebhook') {
      throw new Error('MOCK_PROVIDER_ERROR: Webhook processing failed');
    }

    // Update the response based on the webhook payload
    const statusMap: Record<string, VerificationStatus> = {
      'verification.completed': VerificationStatus.COMPLETED,
      'verification.failed': VerificationStatus.FAILED,
      'verification.processing': VerificationStatus.PROCESSING,
      'verification.expired': VerificationStatus.EXPIRED,
      'session.created': VerificationStatus.PENDING,
    };

    const mappedStatus = statusMap[payload.event] ?? VerificationStatus.PENDING;

    return {
      status: mappedStatus,
      result: payload.result,
      error: payload.error,
    };
  }

  validateWebhookSignature(payload: string, signature: string): boolean {
    if (!this.config.webhookSecret) return true;
    const expected = `sha256=${Buffer.from(payload + this.config.webhookSecret)
      .toString('base64')
      .slice(0, 43)}`;
    return signature === expected;
  }
}

describe('Verification KYC/KYB Integration Test Suite', () => {
  let app: INestApplication | null = null;
  let supabase: InMemorySupabase;
  let stubProvider: StubProvider;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.TRUSTLESSWORK_API_URL = 'https://trustless-work.test';
    process.env.TRUSTLESSWORK_API_KEY = 'tw-test-key';

    try {
      supabase = new InMemorySupabase();
      stubProvider = new StubProvider();

      // Create mock wallet service
      const mockWalletsService = {
        getPrimaryWallet: jest.fn().mockResolvedValue({
          wallet_address: WALLET,
          user_id: USER_ID,
          wallet_type: 'custodial',
          label: 'Primary Wallet',
          is_primary: true,
          is_verified: true,
          verified_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        linkWallet: jest.fn().mockResolvedValue({
          wallet: {
            wallet_address: WALLET,
            user_id: USER_ID,
            wallet_type: 'custodial',
            label: 'Primary Wallet',
            is_primary: true,
            is_verified: true,
            verified_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          error: null,
        }),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [AuthModule],
        controllers: [VerificationController],
        providers: [
          VerificationService,
          VerificationProviderFactory,
          { provide: SupabaseService, useValue: supabase },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                switch (key) {
                  case 'JWT_SECRET':
                    return JWT_SECRET;
                  case 'SUPABASE_URL':
                    return process.env.SUPABASE_URL;
                  case 'SUPABASE_SERVICE_ROLE_KEY':
                    return process.env.SUPABASE_SERVICE_ROLE_KEY;
                  case 'STELLAR_NETWORK':
                    return 'testnet';
                  default:
                    return null;
                }
              }),
            },
          },
          { provide: WalletsService, useValue: mockWalletsService },
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

      const providerFactory = app.get<VerificationProviderFactory>(VerificationProviderFactory);
      providerFactory.registerProvider(stubProvider);
    } catch (error) {
      console.error('Failed to initialize test module:', error);
      throw error;
    }
  });

  beforeEach(() => {
    if (supabase) {
      supabase.reset();
    }
    stubProvider = new StubProvider(); // Reset to default state
    if (app) {
      const providerFactory = app.get<VerificationProviderFactory>(VerificationProviderFactory);
      providerFactory.registerProvider(stubProvider);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const tokenFor = (sub = USER_ID) =>
    jwt.sign({ sub, email: `${sub}@example.com` }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '7d',
    });

  const auth = (sub = USER_ID) => ({ Authorization: `Bearer ${tokenFor(sub)}` });

  describe('KYC/KYB Verification Integration', () => {
    describe('Verification Session Creation', () => {
      it('creates a KYC verification session with mock provider', async () => {
        if (!app) throw new Error('App not initialized');

        stubProvider.configure({
          createSessionResponse: {
            provider_session_id: 'mock-session-kyc-123',
            provider_url: 'https://mock.test/kyc/123',
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          },
        });

        // Try with minimal subject first
        const response = await request(app.getHttpServer())
          .post('/v1/verification/sessions')
          .set(auth())
          .send({
            type: 'kyc',
            subject: {
              type: 'kyc',
            },
            provider: 'mock',
          });

        // Debug: Print response if it fails
        console.log('Response status:', response.status);
        console.log('Response body:', JSON.stringify(response.body, null, 2));

        expect(response.status).toBe(201);
        expect(response.body.error).toBeNull();
        expect(response.body.session).toBeDefined();
        expect(response.body.session.type).toBe('kyc');
        expect(response.body.session.provider).toBe('mock');
        expect(response.body.session.status).toBe('pending');
        expect(response.body.session.provider_session_id).toBe('mock-session-kyc-123');
        expect(response.body.session.provider_url).toBe('https://mock.test/kyc/123');
      });
    });
  });
});
