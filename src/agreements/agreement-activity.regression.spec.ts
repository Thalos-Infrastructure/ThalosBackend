/**
 * Regression: issue #58 / #61 · PR #100 / #104
 * Bug: dispute open/resolve and status changes did not land in agreement_activity
 * with previous_state / new_state columns populated.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgreementsService } from './agreements.service';
import { AgreementActivityService } from './agreement-activity.service';
import { DisputesService } from '../disputes/disputes.service';

type Row = Record<string, unknown>;

function buildDb(seed: {
  agreements: Row[];
  auth_users?: Row[];
  agreement_participants?: Row[];
  disputes?: Row[];
  dispute_resolutions?: Row[];
  agreement_activity?: Row[];
}) {
  const tables: Record<string, Row[]> = {
    agreements: seed.agreements.map((r) => ({ ...r })),
    auth_users: (seed.auth_users ?? []).map((r) => ({ ...r })),
    agreement_participants: (seed.agreement_participants ?? []).map((r) => ({ ...r })),
    disputes: (seed.disputes ?? []).map((r) => ({ ...r })),
    dispute_resolutions: (seed.dispute_resolutions ?? []).map((r) => ({ ...r })),
    agreement_activity: (seed.agreement_activity ?? []).map((r) => ({ ...r })),
  };

  function chain(table: string) {
    const rows = tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    let mode: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | Row[] | null = null;
    let wantSingle = false;
    let wantMaybe = false;

    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = () => self();
    api.eq = (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return self();
    };
    api.in = (col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]));
      return self();
    };
    api.limit = () => self();
    api.order = () => self();
    api.insert = (data: Row | Row[]) => {
      mode = 'insert';
      payload = data;
      return self();
    };
    api.update = (data: Row) => {
      mode = 'update';
      payload = data;
      return self();
    };
    api.single = () => {
      wantSingle = true;
      return finalize();
    };
    api.maybeSingle = () => {
      wantMaybe = true;
      return finalize();
    };

    const finalize = () => {
      if (mode === 'insert') {
        const items = Array.isArray(payload) ? payload : [payload as Row];
        const created = items.map((item, i) => ({
          id: (item.id as string) || `${table}-${tables[table].length + i + 1}`,
          created_at: new Date().toISOString(),
          ...item,
        }));
        tables[table].push(...created);
        return Promise.resolve({
          data: created.length === 1 ? created[0] : created,
          error: null,
        });
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === 'update') {
        matched = matched.map((r) => Object.assign(r, payload as Row));
      }
      if (wantSingle || wantMaybe) {
        const data = matched[0] ?? null;
        if (wantSingle && !data) {
          return Promise.resolve({ data: null, error: { message: 'not found' } });
        }
        return Promise.resolve({ data, error: null });
      }
      return Promise.resolve({ data: matched, error: null });
    };

    (api as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
      finalize().then(resolve);
    return api;
  }

  return { tables, client: { from: (table: string) => chain(table) } };
}

const USER = 'user-1';
const WALLET = 'GWALLET-PAYER';
const RESOLVER = 'GWALLET-RESOLVER';
const AGREEMENT_ID = 'agr-activity-1';

describe('regression: agreement activity logging (issue #58 / #61 · PR #100 / #104)', () => {
  it('openDispute writes dispute_opened + status change with previous/new state', async () => {
    const db = buildDb({
      agreements: [
        {
          id: AGREEMENT_ID,
          status: 'active',
          title: 'Escrow job',
          amount: '100',
          asset: 'USDC',
          created_by: WALLET,
          milestones: [],
        },
      ],
      auth_users: [
        { id: USER, wallet_public_key: WALLET },
        { id: 'user-resolver', wallet_public_key: RESOLVER },
      ],
      agreement_participants: [
        { agreement_id: AGREEMENT_ID, wallet_address: WALLET, role: 'payer' },
        { agreement_id: AGREEMENT_ID, wallet_address: 'GWALLET-PAYEE', role: 'payee' },
      ],
      disputes: [],
      dispute_resolutions: [],
      agreement_activity: [],
    });

    const supabase = { getClient: () => db.client } as never;
    const emitter = new EventEmitter2();
    const activity = new AgreementActivityService(supabase);
    const logSpy = jest.spyOn(activity, 'logActivity');
    const agreements = new AgreementsService(
      supabase,
      emitter,
      activity,
      {
        syncMilestone: jest.fn().mockResolvedValue({ success: true }),
      } as any,
      new AgreementValidationService(),
    );
    const disputes = new DisputesService(supabase, agreements, emitter, activity);

    const result = await disputes.openDispute(USER, {
      agreement_id: AGREEMENT_ID,
      opened_by: WALLET,
      reason: 'Work incomplete',
      evidence_urls: [],
    });

    expect(result.error).toBeNull();

    const actions = logSpy.mock.calls.map((c) => c[2]);
    expect(actions).toContain('dispute_opened');
    expect(actions).toContain('status_changed_to_disputed');

    const statusCall = logSpy.mock.calls.find((c) => c[2] === 'status_changed_to_disputed');
    expect(statusCall?.[4]).toEqual(
      expect.objectContaining({ previousState: 'active', newState: 'disputed' }),
    );

    const persistedStatus = db.tables.agreement_activity.find(
      (r) => r.action === 'status_changed_to_disputed',
    );
    expect(persistedStatus).toEqual(
      expect.objectContaining({
        previous_state: 'active',
        new_state: 'disputed',
      }),
    );

    const persistedDispute = db.tables.agreement_activity.find(
      (r) => r.action === 'dispute_opened',
    );
    expect(persistedDispute).toBeTruthy();
  });

  it('resolveDispute writes dispute_resolved + status change with previous/new state', async () => {
    const db = buildDb({
      agreements: [
        {
          id: AGREEMENT_ID,
          status: 'disputed',
          title: 'Escrow job',
          amount: '100',
          asset: 'USDC',
          created_by: WALLET,
          milestones: [],
        },
      ],
      auth_users: [
        { id: USER, wallet_public_key: WALLET },
        { id: 'user-resolver', wallet_public_key: RESOLVER },
      ],
      agreement_participants: [
        { agreement_id: AGREEMENT_ID, wallet_address: WALLET, role: 'payer' },
      ],
      disputes: [
        {
          id: 'disp-1',
          agreement_id: AGREEMENT_ID,
          opened_by: WALLET,
          reason: 'x',
          evidence_urls: [],
          status: 'under_review',
          resolver_wallet: RESOLVER,
        },
      ],
      dispute_resolutions: [],
      agreement_activity: [],
    });

    const supabase = { getClient: () => db.client } as never;
    const emitter = new EventEmitter2();
    const activity = new AgreementActivityService(supabase);
    const logSpy = jest.spyOn(activity, 'logActivity');
    const agreements = new AgreementsService(
      supabase,
      emitter,
      activity,
      {
        syncMilestone: jest.fn().mockResolvedValue({ success: true }),
      } as any,
      new AgreementValidationService(),
    );
    const disputes = new DisputesService(supabase, agreements, emitter, activity);

    const result = await disputes.resolveDispute('user-resolver', 'disp-1', {
      resolved_by: RESOLVER,
      payer_percentage: 40,
      payee_percentage: 60,
      resolution_notes: 'Split',
    });

    expect(result.error).toBeNull();

    const actions = logSpy.mock.calls.map((c) => c[2]);
    expect(actions).toContain('dispute_resolved');
    expect(actions).toContain('status_changed_to_resolved');

    const statusCall = logSpy.mock.calls.find((c) => c[2] === 'status_changed_to_resolved');
    expect(statusCall?.[4]).toEqual(
      expect.objectContaining({ previousState: 'disputed', newState: 'resolved' }),
    );

    expect(
      db.tables.agreement_activity.find((r) => r.action === 'status_changed_to_resolved'),
    ).toEqual(
      expect.objectContaining({
        previous_state: 'disputed',
        new_state: 'resolved',
      }),
    );
  });
});
