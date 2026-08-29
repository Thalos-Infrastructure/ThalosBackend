/**
 * Applications module — unit tests
 *
 * Covers:
 *  - apply: success, duplicate blocked (ConflictException), opportunity not found,
 *    owner self-application blocked, non-open opportunity blocked
 *  - listApplicants: owner sees all, non-owner sees own, missing opportunity
 *  - updateStatus: accept (fills opportunity + rejects pending), reject,
 *    already-decided blocked, non-owner forbidden
 *
 * Issue #139
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';

// ---------------------------------------------------------------------------
// Lightweight Supabase mock — handles auth_users, profiles, opportunities, applications
// ---------------------------------------------------------------------------

interface Row {
  [key: string]: any;
}

interface Store {
  users: Record<string, string>; // userId → wallet_public_key
  profiles: Record<string, { id: string; wallet: string; account_type: 'personal' | 'enterprise' }>;
  opportunities: Row[];
  applications: Row[];
}

function makeQueryBuilder(store: Store, table: string) {
  const eqFilters: Array<{ key: string; value: any }> = [];
  const neqFilters: Array<{ key: string; value: any }> = [];
  let pendingInsert: Row | null = null;
  let pendingUpdate: Partial<Row> | null = null;
  let isDelete = false;
  let singleMode = false;
  let maybeSingleMode = false;
  let orderClause: { column: string; ascending: boolean } | null = null;

  const builder: any = {
    select: () => builder,
    eq(key: string, value: any) {
      eqFilters.push({ key, value });
      return builder;
    },
    neq(key: string, value: any) {
      neqFilters.push({ key, value });
      return builder;
    },
    order(column: string, opts?: { ascending: boolean }) {
      orderClause = { column, ascending: opts?.ascending ?? true };
      return builder;
    },
    maybeSingle() {
      maybeSingleMode = true;
      return builder;
    },
    single() {
      singleMode = true;
      return builder;
    },
    insert(row: Row) {
      pendingInsert = row;
      return builder;
    },
    update(patch: Partial<Row>) {
      pendingUpdate = patch;
      return builder;
    },
    delete() {
      isDelete = true;
      return builder;
    },
    then(resolve: (v: any) => any) {
      // --- auth_users ---
      if (table === 'auth_users') {
        const id = eqFilters.find((f) => f.key === 'id')?.value;
        const wallet = id ? store.users[id] : undefined;
        return resolve({ data: wallet ? { wallet_public_key: wallet } : null, error: null });
      }

      // --- profiles ---
      if (table === 'profiles') {
        const walletAddr = eqFilters.find((f) => f.key === 'wallet_address')?.value;
        const profile = walletAddr
          ? Object.values(store.profiles).find((p) => p.wallet === walletAddr)
          : undefined;
        if (maybeSingleMode || singleMode) {
          return resolve({
            data: profile ? { id: profile.id, account_type: profile.account_type } : null,
            error: null,
          });
        }
        return resolve({
          data: profile ? [{ id: profile.id, account_type: profile.account_type }] : [],
          error: null,
        });
      }

      // --- DELETE ---
      if (isDelete) {
        const rows = (store as any)[table];
        (store as any)[table] = rows.filter(
          (r: Row) => !eqFilters.every(({ key, value }) => r[key] === value),
        );
        return resolve({ data: null, error: null });
      }

      // --- INSERT ---
      if (pendingInsert) {
        // Simulate unique-constraint violation for applications
        if (table === 'applications') {
          const existing = store.applications.find(
            (r) =>
              r.opportunity_id === pendingInsert!.opportunity_id &&
              r.builder_id === pendingInsert!.builder_id,
          );
          if (existing) {
            return resolve({ data: null, error: { message: 'duplicate', code: '23505' } });
          }
        }
        const newRow: Row = {
          id: `gen-${Date.now()}-${Math.random()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(table === 'applications' ? { status: 'pending', message: '' } : {}),
          ...pendingInsert,
        };
        (store as any)[table] = [...(store as any)[table], newRow];
        if (singleMode) return resolve({ data: newRow, error: null });
        return resolve({ data: [newRow], error: null });
      }

      // --- UPDATE ---
      if (pendingUpdate) {
        let updated: Row | null = null;
        const rows = (store as any)[table];
        (store as any)[table] = rows.map((r: Row) => {
          const matchesEq = eqFilters.every(({ key, value }) => r[key] === value);
          const matchesNeq = neqFilters.every(({ key, value }) => r[key] !== value);
          if (matchesEq && matchesNeq) {
            updated = { ...r, ...pendingUpdate, updated_at: new Date().toISOString() };
            return updated;
          }
          return r;
        });
        if (singleMode) return resolve({ data: updated, error: null });
        return resolve({ data: updated ? [updated] : [], error: null });
      }

      // --- SELECT ---
      let rows = [...(store as any)[table]];
      for (const { key, value } of eqFilters) {
        rows = rows.filter((r: Row) => r[key] === value);
      }
      for (const { key, value } of neqFilters) {
        rows = rows.filter((r: Row) => r[key] !== value);
      }
      if (orderClause) {
        rows.sort((a: Row, b: Row) => {
          if (a[orderClause!.column] < b[orderClause!.column])
            return orderClause!.ascending ? -1 : 1;
          if (a[orderClause!.column] > b[orderClause!.column])
            return orderClause!.ascending ? 1 : -1;
          return 0;
        });
      }
      if (maybeSingleMode) return resolve({ data: rows[0] ?? null, error: null });
      if (singleMode) return resolve({ data: rows[0] ?? null, error: null });
      return resolve({ data: rows, error: null });
    },
  };
  return builder;
}

function makeSupabaseMock(store: Store) {
  return {
    getClient: () => ({
      from: (table: string) => makeQueryBuilder(store, table),
    }),
  } as any;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const OWNER_USER = 'user-owner';
const BUILDER_USER = 'user-builder';
const OTHER_BUILDER_USER = 'user-other-builder';
const PERSONAL_USER = 'user-personal';
const OWNER_WALLET = 'G_OWNER';
const BUILDER_WALLET = 'G_BUILDER';
const OTHER_BUILDER_WALLET = 'G_OTHER_BUILDER';
const PERSONAL_WALLET = 'G_PERSONAL';
const OWNER_PROFILE = 'profile-owner';
const BUILDER_PROFILE = 'profile-builder';
const OTHER_BUILDER_PROFILE = 'profile-other-builder';
const PERSONAL_PROFILE = 'profile-personal';
const OPP_ID = '00000000-0000-0000-0000-000000000001';

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    users: {
      [OWNER_USER]: OWNER_WALLET,
      [BUILDER_USER]: BUILDER_WALLET,
      [OTHER_BUILDER_USER]: OTHER_BUILDER_WALLET,
      [PERSONAL_USER]: PERSONAL_WALLET,
    },
    profiles: {
      [OWNER_PROFILE]: { id: OWNER_PROFILE, wallet: OWNER_WALLET, account_type: 'enterprise' },
      [BUILDER_PROFILE]: { id: BUILDER_PROFILE, wallet: BUILDER_WALLET, account_type: 'personal' },
      [OTHER_BUILDER_PROFILE]: {
        id: OTHER_BUILDER_PROFILE,
        wallet: OTHER_BUILDER_WALLET,
        account_type: 'personal',
      },
      [PERSONAL_PROFILE]: {
        id: PERSONAL_PROFILE,
        wallet: PERSONAL_WALLET,
        account_type: 'personal',
      },
    },
    opportunities: [
      {
        id: OPP_ID,
        project_id: OWNER_PROFILE,
        status: 'open',
        title: 'Test Opportunity',
        description: 'A test opportunity.',
        skills_required: ['rust'],
        budget_amount: 1000,
        budget_asset: 'USDC',
        engagement_type: 'fixed',
        created_at: new Date().toISOString(),
      },
    ],
    applications: [],
    ...overrides,
  };
}

function buildService(store: Store) {
  return new ApplicationsService(makeSupabaseMock(store));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApplicationsService', () => {
  // -------------------------------------------------------------------------
  // apply
  // -------------------------------------------------------------------------
  describe('apply', () => {
    it('inserts a new application and returns it', async () => {
      const store = makeStore();
      const svc = buildService(store);

      const result = await svc.apply(BUILDER_USER, {
        opportunity_id: OPP_ID,
        message: 'Hello from builder',
      });

      expect(result.error).toBeNull();
      expect(result.application).toBeTruthy();
      expect(result.application.opportunity_id).toBe(OPP_ID);
      expect(result.application.builder_id).toBe(BUILDER_USER);
      expect(result.application.status).toBe('pending');
      expect(result.application.message).toBe('Hello from builder');
      expect(store.applications).toHaveLength(1);
    });

    it('defaults message to empty string when omitted', async () => {
      const store = makeStore();
      const svc = buildService(store);

      const result = await svc.apply(BUILDER_USER, { opportunity_id: OPP_ID });

      expect(result.error).toBeNull();
      expect(result.application.message).toBe('');
    });

    it('throws ConflictException on duplicate (same opportunity + builder)', async () => {
      const store = makeStore({
        applications: [
          {
            id: 'app-1',
            opportunity_id: OPP_ID,
            builder_id: BUILDER_USER,
            message: '',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
      const svc = buildService(store);

      await expect(svc.apply(BUILDER_USER, { opportunity_id: OPP_ID })).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when opportunity does not exist', async () => {
      const store = makeStore();
      const svc = buildService(store);

      await expect(
        svc.apply(BUILDER_USER, { opportunity_id: '00000000-0000-0000-0000-999999999999' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when owner applies to own opportunity', async () => {
      const store = makeStore();
      const svc = buildService(store);

      await expect(svc.apply(OWNER_USER, { opportunity_id: OPP_ID })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ConflictException when opportunity is not open', async () => {
      const store = makeStore({
        opportunities: [
          {
            id: OPP_ID,
            project_id: OWNER_PROFILE,
            status: 'filled',
            title: 'Filled Opportunity',
            description: 'Already filled.',
            skills_required: [],
            budget_amount: 500,
            budget_asset: 'USDC',
            engagement_type: 'fixed',
            created_at: new Date().toISOString(),
          },
        ],
      });
      const svc = buildService(store);

      await expect(svc.apply(BUILDER_USER, { opportunity_id: OPP_ID })).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ForbiddenException when user has no wallet', async () => {
      const store = makeStore({ users: {} });
      const svc = buildService(store);

      await expect(svc.apply(BUILDER_USER, { opportunity_id: OPP_ID })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // listApplicants
  // -------------------------------------------------------------------------
  describe('listApplicants', () => {
    const existingApplication = {
      id: 'app-1',
      opportunity_id: OPP_ID,
      builder_id: BUILDER_USER,
      message: 'Looking good',
      status: 'pending' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it('returns all applications when called by the opportunity owner', async () => {
      const store = makeStore({ applications: [existingApplication] });
      const svc = buildService(store);

      const result = await svc.listApplicants(OWNER_USER, { opportunity_id: OPP_ID });

      expect(result.error).toBeNull();
      expect(result.applications).toHaveLength(1);
      expect(result.applications[0].builder_id).toBe(BUILDER_USER);
    });

    it('returns empty array when there are no applicants', async () => {
      const store = makeStore();
      const svc = buildService(store);

      const result = await svc.listApplicants(OWNER_USER, { opportunity_id: OPP_ID });

      expect(result.error).toBeNull();
      expect(result.applications).toHaveLength(0);
    });

    it('returns only the builder own application when called by non-owner', async () => {
      const otherApp = {
        id: 'app-2',
        opportunity_id: OPP_ID,
        builder_id: OTHER_BUILDER_USER,
        message: 'Other builder',
        status: 'pending' as const,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const store = makeStore({ applications: [existingApplication, otherApp] });
      const svc = buildService(store);

      const result = await svc.listApplicants(BUILDER_USER, { opportunity_id: OPP_ID });

      expect(result.error).toBeNull();
      expect(result.applications).toHaveLength(1);
      expect(result.applications[0].builder_id).toBe(BUILDER_USER);
    });

    it('returns empty array when builder has not applied', async () => {
      const store = makeStore({ applications: [] });
      const svc = buildService(store);

      const result = await svc.listApplicants(BUILDER_USER, { opportunity_id: OPP_ID });

      expect(result.error).toBeNull();
      expect(result.applications).toHaveLength(0);
    });

    it('throws NotFoundException when opportunity does not exist', async () => {
      const store = makeStore();
      const svc = buildService(store);

      await expect(
        svc.listApplicants(OWNER_USER, { opportunity_id: '00000000-0000-0000-0000-999999999999' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // updateStatus
  // -------------------------------------------------------------------------
  describe('updateStatus', () => {
    function makeStoreWithPendingApp(overrides: Partial<Store> = {}) {
      return makeStore({
        applications: [
          {
            id: 'app-pending',
            opportunity_id: OPP_ID,
            builder_id: BUILDER_USER,
            message: '',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        ...overrides,
      });
    }

    it('accepts a pending application', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      const result = await svc.updateStatus(OWNER_USER, 'app-pending', { status: 'accepted' });

      expect(result.error).toBeNull();
      expect(result.application.status).toBe('accepted');
    });

    it('rejects a pending application', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      const result = await svc.updateStatus(OWNER_USER, 'app-pending', { status: 'rejected' });

      expect(result.error).toBeNull();
      expect(result.application.status).toBe('rejected');
    });

    it('marks the opportunity as filled when application is accepted', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      await svc.updateStatus(OWNER_USER, 'app-pending', { status: 'accepted' });

      const opp = store.opportunities.find((o) => o.id === OPP_ID);
      expect(opp?.status).toBe('filled');
    });

    it('rejects other pending applications when one is accepted', async () => {
      const store = makeStoreWithPendingApp({
        applications: [
          {
            id: 'app-pending-1',
            opportunity_id: OPP_ID,
            builder_id: BUILDER_USER,
            message: '',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'app-pending-2',
            opportunity_id: OPP_ID,
            builder_id: OTHER_BUILDER_USER,
            message: '',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
      const svc = buildService(store);

      await svc.updateStatus(OWNER_USER, 'app-pending-1', { status: 'accepted' });

      const app2 = store.applications.find((a) => a.id === 'app-pending-2');
      expect(app2?.status).toBe('rejected');
    });

    it('does NOT change opportunity status when application is rejected', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      await svc.updateStatus(OWNER_USER, 'app-pending', { status: 'rejected' });

      const opp = store.opportunities.find((o) => o.id === OPP_ID);
      expect(opp?.status).toBe('open');
    });

    it('throws ConflictException when application is already decided', async () => {
      const store = makeStore({
        applications: [
          {
            id: 'app-accepted',
            opportunity_id: OPP_ID,
            builder_id: BUILDER_USER,
            message: '',
            status: 'accepted',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
      const svc = buildService(store);

      await expect(
        svc.updateStatus(OWNER_USER, 'app-accepted', { status: 'rejected' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when called by a non-owner', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      await expect(
        svc.updateStatus(BUILDER_USER, 'app-pending', { status: 'accepted' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the application does not exist', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      await expect(
        svc.updateStatus(OWNER_USER, '00000000-0000-0000-0000-999999999999', {
          status: 'accepted',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
