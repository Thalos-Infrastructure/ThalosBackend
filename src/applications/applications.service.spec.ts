/**
 * Applications module — unit tests
 *
 * Covers:
 *  - apply: success, duplicate blocked (ConflictException), opportunity not found
 *  - listApplicants: owner can list, non-owner is forbidden
 *  - updateStatus: accept, reject, already-decided application blocked, not-owner forbidden
 *  - Opportunity filled_at updated on acceptance (best-effort)
 *
 * Issue #139
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';

// ---------------------------------------------------------------------------
// Lightweight Supabase mock
// ---------------------------------------------------------------------------

interface Row {
  [key: string]: any;
}

type Store = Record<string, Row[]>;

function makeQueryBuilder(store: Store, table: string) {
  let rows: Row[] = store[table] ? [...store[table]] : [];
  let pendingInsert: Row | null = null;
  let pendingUpdate: Partial<Row> | null = null;
  let isDelete = false;
  const eqFilters: Array<{ key: string; value: any }> = [];
  let singleMode = false;
  let maybeSingleMode = false;

  const builder: any = {
    select: () => builder,
    eq(key: string, value: any) {
      eqFilters.push({ key, value });
      return builder;
    },
    order: () => builder,
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
      const filtered = () =>
        rows.filter((r) => eqFilters.every(({ key, value }) => r[key] === value));

      if (isDelete) {
        store[table] = (store[table] ?? []).filter(
          (r) => !eqFilters.every(({ key, value }) => r[key] === value),
        );
        return resolve({ data: null, error: null });
      }

      if (pendingInsert) {
        const existing = (store[table] ?? []).find((r) =>
          eqFilters.every(({ key, value }) => r[key] === value),
        );
        // Simulate unique-constraint violation
        if (
          table === 'applications' &&
          (store[table] ?? []).some(
            (r) =>
              r.opportunity_id === (pendingInsert as Row).opportunity_id &&
              r.builder_id === (pendingInsert as Row).builder_id,
          )
        ) {
          return resolve({ data: null, error: { message: 'duplicate', code: '23505' } });
        }
        // Apply DB-side column defaults so assertions on status etc. work.
        const columnDefaults: Row =
          table === 'applications' ? { status: 'pending', message: '' } : {};
        const newRow = {
          id: `gen-${Date.now()}-${Math.random()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...columnDefaults,
          ...pendingInsert,
        };
        store[table] = [...(store[table] ?? []), newRow];
        if (singleMode) return resolve({ data: newRow, error: null });
        return resolve({ data: [newRow], error: null });
      }

      if (pendingUpdate) {
        let updated: Row | null = null;
        store[table] = (store[table] ?? []).map((r) => {
          if (eqFilters.every(({ key, value }) => r[key] === value)) {
            updated = { ...r, ...pendingUpdate, updated_at: new Date().toISOString() };
            return updated;
          }
          return r;
        });
        if (singleMode) return resolve({ data: updated, error: null });
        return resolve({ data: updated ? [updated] : [], error: null });
      }

      // SELECT
      const result = filtered();
      if (maybeSingleMode) return resolve({ data: result[0] ?? null, error: null });
      if (singleMode) return resolve({ data: result[0] ?? null, error: null });
      return resolve({ data: result, error: null });
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
// Test helpers
// ---------------------------------------------------------------------------

const OWNER_ID = 'user-owner-1';
const BUILDER_ID = 'user-builder-1';
const OTHER_BUILDER_ID = 'user-builder-2';
const OPP_ID = 'opp-00000000-0000-0000-0000-000000000001';

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    auth_users: [
      { id: OWNER_ID },
      { id: BUILDER_ID },
      { id: OTHER_BUILDER_ID },
    ],
    opportunities: [{ id: OPP_ID, owner_id: OWNER_ID }],
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

      const result = await svc.apply(BUILDER_ID, {
        opportunity_id: OPP_ID,
        message: 'Hello from builder',
      });

      expect(result.error).toBeNull();
      expect(result.application).toBeTruthy();
      expect(result.application!.opportunity_id).toBe(OPP_ID);
      expect(result.application!.builder_id).toBe(BUILDER_ID);
      expect(result.application!.status).toBe('pending');
      expect(result.application!.message).toBe('Hello from builder');
      expect(store.applications).toHaveLength(1);
    });

    it('defaults message to empty string when omitted', async () => {
      const store = makeStore();
      const svc = buildService(store);

      const result = await svc.apply(BUILDER_ID, { opportunity_id: OPP_ID });

      expect(result.error).toBeNull();
      expect(result.application!.message).toBe('');
    });

    it('throws ConflictException on duplicate (same opportunity + builder)', async () => {
      const store = makeStore({
        applications: [
          {
            id: 'app-1',
            opportunity_id: OPP_ID,
            builder_id: BUILDER_ID,
            message: '',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
      const svc = buildService(store);

      await expect(
        svc.apply(BUILDER_ID, { opportunity_id: OPP_ID }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when opportunity does not exist', async () => {
      const store = makeStore();
      const svc = buildService(store);

      await expect(
        svc.apply(BUILDER_ID, { opportunity_id: 'non-existent-opp' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user is not found', async () => {
      const store = makeStore({ auth_users: [] }); // no users
      const svc = buildService(store);

      await expect(
        svc.apply('ghost-user', { opportunity_id: OPP_ID }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // listApplicants
  // -------------------------------------------------------------------------
  describe('listApplicants', () => {
    const existingApplication = {
      id: 'app-1',
      opportunity_id: OPP_ID,
      builder_id: BUILDER_ID,
      message: 'Looking good',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it('returns applications when called by the opportunity owner', async () => {
      const store = makeStore({ applications: [existingApplication] });
      const svc = buildService(store);

      const result = await svc.listApplicants(OWNER_ID, { opportunity_id: OPP_ID });

      expect(result.error).toBeNull();
      expect(result.applications).toHaveLength(1);
      expect(result.applications[0].builder_id).toBe(BUILDER_ID);
    });

    it('returns empty array when there are no applicants', async () => {
      const store = makeStore();
      const svc = buildService(store);

      const result = await svc.listApplicants(OWNER_ID, { opportunity_id: OPP_ID });

      expect(result.error).toBeNull();
      expect(result.applications).toHaveLength(0);
    });

    it('throws ForbiddenException when called by a non-owner', async () => {
      const store = makeStore({ applications: [existingApplication] });
      const svc = buildService(store);

      await expect(
        svc.listApplicants(BUILDER_ID, { opportunity_id: OPP_ID }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when opportunity does not exist', async () => {
      const store = makeStore();
      const svc = buildService(store);

      await expect(
        svc.listApplicants(OWNER_ID, { opportunity_id: 'non-existent-opp' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // updateStatus
  // -------------------------------------------------------------------------
  describe('updateStatus', () => {
    function makeStoreWithPendingApp() {
      return makeStore({
        applications: [
          {
            id: 'app-pending',
            opportunity_id: OPP_ID,
            builder_id: BUILDER_ID,
            message: '',
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        opportunities: [{ id: OPP_ID, owner_id: OWNER_ID, filled_at: null }],
      });
    }

    it('accepts a pending application', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      const result = await svc.updateStatus(OWNER_ID, 'app-pending', { status: 'accepted' });

      expect(result.error).toBeNull();
      expect(result.application!.status).toBe('accepted');
    });

    it('rejects a pending application', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      const result = await svc.updateStatus(OWNER_ID, 'app-pending', { status: 'rejected' });

      expect(result.error).toBeNull();
      expect(result.application!.status).toBe('rejected');
    });

    it('marks the opportunity as filled when application is accepted', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      await svc.updateStatus(OWNER_ID, 'app-pending', { status: 'accepted' });

      const opp = store.opportunities.find((o) => o.id === OPP_ID);
      expect(opp?.filled_at).toBeTruthy();
    });

    it('does NOT update filled_at when application is rejected', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      await svc.updateStatus(OWNER_ID, 'app-pending', { status: 'rejected' });

      const opp = store.opportunities.find((o) => o.id === OPP_ID);
      expect(opp?.filled_at).toBeNull();
    });

    it('throws ConflictException when application is already decided', async () => {
      const store = makeStore({
        applications: [
          {
            id: 'app-accepted',
            opportunity_id: OPP_ID,
            builder_id: BUILDER_ID,
            message: '',
            status: 'accepted',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
      const svc = buildService(store);

      await expect(
        svc.updateStatus(OWNER_ID, 'app-accepted', { status: 'rejected' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when called by a non-owner', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      await expect(
        svc.updateStatus(BUILDER_ID, 'app-pending', { status: 'accepted' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the application does not exist', async () => {
      const store = makeStoreWithPendingApp();
      const svc = buildService(store);

      await expect(
        svc.updateStatus(OWNER_ID, 'non-existent-app', { status: 'accepted' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
