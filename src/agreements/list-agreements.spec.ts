/**
 * AgreementsService.list — the backing query for `GET /v1/agreements`.
 *
 * Covers the three things the endpoint promises: results scoped to the
 * authenticated user (across every wallet they own), correct `status` / `type`
 * filtering, and an `{ agreements, error }` envelope that degrades to an empty
 * list instead of throwing when there is nothing to show or Supabase fails.
 */
import 'reflect-metadata';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { AgreementsService } from './agreements.service';
import { AgreementActivityService } from './agreement-activity.service';
import { AgreementSyncService } from './sync/agreement-sync.service';
import { AgreementValidationService } from './validation/agreement-validation.service';
import type { SupabaseService } from '../supabase/supabase.service';

type Row = Record<string, unknown>;
type Filter = { key: string; op: 'eq' | 'in'; value: unknown };
type QueryResult = { data: Row[] | Row | null; error: { message: string } | null };

const USER = 'list-user';
const OTHER_USER = 'list-user-other';
const WALLETLESS_USER = 'list-user-walletless';
const WALLET_A = 'GLISTPRIMARY000000000000000000000000000000000000000000';
const WALLET_B = 'GLISTSECONDARY0000000000000000000000000000000000000000';
const OTHER_WALLET = 'GLISTOUTSIDER00000000000000000000000000000000000000000';

class QueryBuilder implements PromiseLike<QueryResult> {
  private filters: Filter[] = [];
  private orderBy: { key: string; ascending: boolean } | undefined;

  constructor(
    private readonly db: InMemoryDb,
    private readonly table: string,
  ) {}

  select(_columns = '*') {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, op: 'eq', value });
    return this;
  }

  in(key: string, value: unknown[]) {
    this.filters.push({ key, op: 'in', value });
    return this;
  }

  order(key: string, options?: { ascending?: boolean }) {
    this.orderBy = { key, ascending: options?.ascending ?? true };
    return this;
  }

  maybeSingle() {
    const { data, error } = this.execute();
    const rows = Array.isArray(data) ? data : [];
    return Promise.resolve({ data: error ? null : (rows[0] ?? null), error });
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    const forced = this.db.consumeFailure(this.table);
    if (forced) return { data: null, error: { message: forced } };

    let rows = this.db.select(this.table, this.filters);
    if (this.orderBy) {
      const { key, ascending } = this.orderBy;
      // Every column ordered on in these tests is an ISO timestamp, so string
      // comparison is the same as chronological comparison.
      rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
      if (!ascending) rows.reverse();
    }
    return { data: rows, error: null };
  }
}

class InMemoryDb {
  tables: Record<string, Row[]> = {};
  private failures: string[] = [];

  getClient() {
    return { from: (table: string) => new QueryBuilder(this, table) };
  }

  failOnce(table: string, message: string) {
    this.failures.push(`${table}::${message}`);
  }

  consumeFailure(table: string): string | null {
    const index = this.failures.findIndex((f) => f.startsWith(`${table}::`));
    if (index === -1) return null;
    const [failure] = this.failures.splice(index, 1);
    return failure.slice(`${table}::`.length);
  }

  select(table: string, filters: Filter[]) {
    return (this.tables[table] ?? [])
      .filter((row) =>
        filters.every((f) =>
          f.op === 'in' ? (f.value as unknown[]).includes(row[f.key]) : row[f.key] === f.value,
        ),
      )
      .map((row) => ({ ...row }));
  }
}

/** id → title, so assertions read as the agreements a user should see. */
const titles = (result: { agreements: Row[] }) => result.agreements.map((a) => a.title as string);

describe('AgreementsService.list', () => {
  let db: InMemoryDb;
  let service: AgreementsService;

  beforeEach(() => {
    db = new InMemoryDb();
    db.tables = {
      auth_users: [
        { id: USER, wallet_public_key: WALLET_A },
        { id: OTHER_USER, wallet_public_key: OTHER_WALLET },
        { id: WALLETLESS_USER, wallet_public_key: null },
      ],
      user_wallets: [
        { user_id: USER, wallet_address: WALLET_A, is_primary: true },
        { user_id: USER, wallet_address: WALLET_B, is_primary: false },
        { user_id: OTHER_USER, wallet_address: OTHER_WALLET, is_primary: true },
      ],
      agreements: [
        {
          id: 'agr-created-active-multi',
          title: 'created · active · multi',
          status: 'active',
          agreement_type: 'multi',
          created_by: WALLET_A,
          created_at: '2026-03-01T00:00:00.000Z',
        },
        {
          id: 'agr-created-completed-single',
          title: 'created · completed · single',
          status: 'completed',
          agreement_type: 'single',
          created_by: WALLET_A,
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          // Reached through the user's *second* wallet, as a participant only.
          id: 'agr-participant-active-single',
          title: 'participant · active · single',
          status: 'active',
          agreement_type: 'single',
          created_by: OTHER_WALLET,
          created_at: '2026-02-01T00:00:00.000Z',
        },
        {
          id: 'agr-foreign',
          title: 'someone else · active · multi',
          status: 'active',
          agreement_type: 'multi',
          created_by: OTHER_WALLET,
          created_at: '2026-04-01T00:00:00.000Z',
        },
      ],
      agreement_participants: [
        { agreement_id: 'agr-participant-active-single', wallet_address: WALLET_B, role: 'payee' },
        { agreement_id: 'agr-foreign', wallet_address: OTHER_WALLET, role: 'payer' },
      ],
    };

    const syncEngine = {
      syncAgreement: jest.fn(),
      syncStatusTransition: jest.fn(),
      validateContractOnTrustless: jest.fn(),
      reconcileAgreement: jest.fn(),
    } as unknown as AgreementSyncService;

    service = new AgreementsService(
      db as unknown as SupabaseService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      new AgreementActivityService(db as unknown as SupabaseService),
      syncEngine,
      new AgreementValidationService(),
    );
  });

  describe('auth scoping', () => {
    it('returns agreements from every wallet the user owns, newest first', async () => {
      const result = await service.list(USER, {});

      expect(result.error).toBeNull();
      expect(titles(result)).toEqual([
        'created · active · multi', // 2026-03-01
        'participant · active · single', // 2026-02-01, via WALLET_B
        'created · completed · single', // 2026-01-01
      ]);
    });

    it('never leaks an agreement the user neither created nor takes part in', async () => {
      const result = await service.list(USER, {});
      expect(titles(result)).not.toContain('someone else · active · multi');
    });

    it('scopes to the caller — another user sees only their own agreements', async () => {
      const result = await service.list(OTHER_USER, {});

      expect(result.error).toBeNull();
      expect(titles(result).sort()).toEqual([
        'participant · active · single',
        'someone else · active · multi',
      ]);
    });

    it('lists empty (not 403) for a user with no linked wallet', async () => {
      await expect(service.list(WALLETLESS_USER, {})).resolves.toEqual({
        agreements: [],
        error: null,
      });
    });
  });

  describe('filters', () => {
    it('filters by status', async () => {
      const result = await service.list(USER, { status: 'active' });

      expect(result.error).toBeNull();
      expect(titles(result)).toEqual(['created · active · multi', 'participant · active · single']);
    });

    it('filters by type', async () => {
      const result = await service.list(USER, { type: 'single' });

      expect(result.error).toBeNull();
      expect(titles(result)).toEqual([
        'participant · active · single',
        'created · completed · single',
      ]);
    });

    it('applies status and type together', async () => {
      const result = await service.list(USER, { status: 'active', type: 'single' });

      expect(titles(result)).toEqual(['participant · active · single']);
    });

    it('returns an empty list when the filters match nothing', async () => {
      await expect(service.list(USER, { status: 'disputed' })).resolves.toEqual({
        agreements: [],
        error: null,
      });
    });

    it('treats undefined filters as "no filter"', async () => {
      const explicit = await service.list(USER, { status: undefined, type: undefined });
      const omitted = await service.list(USER, {});

      expect(titles(explicit)).toEqual(titles(omitted));
    });

    it('returns an empty list when the user has no agreements at all', async () => {
      db.tables.agreements = [];
      db.tables.agreement_participants = [];

      await expect(service.list(USER, {})).resolves.toEqual({ agreements: [], error: null });
    });
  });

  describe('error states', () => {
    it('surfaces a participants lookup failure', async () => {
      db.failOnce('agreement_participants', 'participants unavailable');

      await expect(service.list(USER, {})).resolves.toEqual({
        agreements: [],
        error: 'participants unavailable',
      });
    });

    it('surfaces an agreements lookup failure', async () => {
      db.failOnce('agreements', 'agreements unavailable');

      await expect(service.list(USER, {})).resolves.toEqual({
        agreements: [],
        error: 'agreements unavailable',
      });
    });
  });
});
