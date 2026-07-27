import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgreementsService } from './agreements.service';
import { AgreementActivityService } from './agreement-activity.service';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import { DisputesService } from '../disputes/disputes.service';
import { DISPUTE_OPENED, DISPUTE_RESOLVED } from '../common/constants/notification-events';

type Row = Record<string, unknown>;

/**
 * Minimal in-memory Supabase stub covering the chains used by
 * AgreementsService.applyStatusChange / updateStatus and DisputesService open/resolve.
 */
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

  const activityInserts: Row[] = [];

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
          updated_at: new Date().toISOString(),
          ...item,
        }));
        tables[table].push(...created);
        if (table === 'agreement_activity') activityInserts.push(...created);
        const data = created.length === 1 ? created[0] : created;
        return Promise.resolve({ data, error: null });
      }

      let matched = rows.filter((r) => filters.every((f) => f(r)));

      if (mode === 'update') {
        matched = matched.map((r) => {
          Object.assign(r, payload as Row);
          return r;
        });
        // when chained .select after update
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

    // bare await on chain (e.g. update without single)
    (api as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
      finalize().then(resolve);

    return api;
  }

  return {
    tables,
    activityInserts,
    client: {
      from: (table: string) => chain(table),
    },
  };
}

const USER = 'user-1';
const WALLET = 'GWALLET-PAYER';
const RESOLVER = 'GWALLET-RESOLVER';
const AGREEMENT_ID = 'agr-dispute-1';

function makeAgreements(db: ReturnType<typeof buildDb>, emitter: EventEmitter2) {
  const supabase = { getClient: () => db.client } as never;
  const activity = new AgreementActivityService(supabase);
  // spy so tests can assert shared path — keep the Mock handle (avoids unbound-method)
  const logActivity = jest.spyOn(activity, 'logActivity');
  const svc = new AgreementsService(supabase, emitter, activity);
  return { svc, activity, logActivity };
}

function makeDisputes(
  db: ReturnType<typeof buildDb>,
  emitter: EventEmitter2,
  agreements: AgreementsService,
  activity: AgreementActivityService,
) {
  const supabase = { getClient: () => db.client } as never;
  return new DisputesService(supabase, agreements, emitter, activity);
}

describe('dispute-driven Agreement side effects (issue #58)', () => {
  let db: ReturnType<typeof buildDb>;
  let emitter: EventEmitter2;
  let agreements: AgreementsService;
  let activity: AgreementActivityService;
  let logActivity: jest.SpyInstance;
  let disputes: DisputesService;
  let emitted: Array<{ event: string; payload: unknown }>;

  beforeEach(() => {
    db = buildDb({
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
    emitter = new EventEmitter2();
    emitted = [];
    emitter.onAny((event, payload) => {
      emitted.push({ event: String(event), payload });
    });
    ({ svc: agreements, activity, logActivity } = makeAgreements(db, emitter));
    disputes = makeDisputes(db, emitter, agreements, activity);
  });

  it('unit: openDispute uses shared activity + emits DISPUTE_OPENED + status_changed_to_disputed', async () => {
    const applySpy = jest.spyOn(agreements, 'applyStatusChange');

    const result = await disputes.openDispute(USER, {
      agreement_id: AGREEMENT_ID,
      opened_by: WALLET,
      reason: 'Work incomplete',
      evidence_urls: [],
    });

    expect(result.error).toBeNull();
    expect(result.dispute).toBeTruthy();
    expect(applySpy).toHaveBeenCalledWith(
      AGREEMENT_ID,
      WALLET,
      'disputed',
      expect.objectContaining({
        activityDetails: expect.objectContaining({ source: 'dispute' }),
      }),
    );

    // shared logActivity used (at least status_changed + dispute_opened)
    expect(logActivity).toHaveBeenCalled();

    const actions = logActivity.mock.calls.map((c) => c[2] as string);
    expect(actions).toContain('status_changed_to_disputed');
    expect(actions).toContain('dispute_opened');

    expect(emitted.some((e) => e.event === DISPUTE_OPENED)).toBe(true);
    expect(db.tables.agreements[0].status).toBe('disputed');
  });

  it('unit: resolveDispute uses shared path + emits DISPUTE_RESOLVED + COMPLETED', async () => {
    // seed open dispute under review
    db.tables.disputes.push({
      id: 'disp-1',
      agreement_id: AGREEMENT_ID,
      opened_by: WALLET,
      reason: 'x',
      evidence_urls: [],
      status: 'under_review',
      resolver_wallet: RESOLVER,
    });
    db.tables.agreements[0].status = 'disputed';
    db.tables.auth_users.push({ id: 'user-resolver', wallet_public_key: RESOLVER });

    // resolver user id must match wallet
    const applySpy = jest.spyOn(agreements, 'applyStatusChange');
    const result = await disputes.resolveDispute('user-resolver', 'disp-1', {
      resolved_by: RESOLVER,
      payer_percentage: 40,
      payee_percentage: 60,
      resolution_notes: 'Split',
    });

    expect(result.error).toBeNull();
    expect(applySpy).toHaveBeenCalledWith(
      AGREEMENT_ID,
      RESOLVER,
      'resolved',
      expect.objectContaining({
        activityDetails: expect.objectContaining({ source: 'dispute' }),
      }),
    );

    const actions = logActivity.mock.calls.map((c) => c[2] as string);
    expect(actions).toContain('status_changed_to_resolved');
    expect(actions).toContain('dispute_resolved');

    expect(emitted.some((e) => e.event === DISPUTE_RESOLVED)).toBe(true);
    expect(emitted.some((e) => e.event === AGREEMENT_EVENTS.COMPLETED)).toBe(true);
    expect(db.tables.agreements[0].status).toBe('resolved');
  });

  it('parity: dispute-driven disputed status log matches normal updateStatus shape', async () => {
    // normal path
    const normalDb = buildDb({
      agreements: [
        {
          id: 'agr-normal',
          status: 'active',
          title: 'N',
          amount: '10',
          asset: 'USDC',
          created_by: WALLET,
          milestones: [],
        },
      ],
      auth_users: [{ id: USER, wallet_public_key: WALLET }],
      agreement_participants: [
        { agreement_id: 'agr-normal', wallet_address: WALLET, role: 'payer' },
      ],
    });
    const normalEmitter = new EventEmitter2();
    const { svc: normalAgreements, logActivity: normalLog } = makeAgreements(
      normalDb,
      normalEmitter,
    );
    await normalAgreements.updateStatus(USER, 'agr-normal', {
      actor_wallet: WALLET,
      status: 'disputed',
    });
    const normalCall = normalLog.mock.calls.find((c) => c[2] === 'status_changed_to_disputed');
    expect(normalCall).toBeTruthy();
    const normalDetails = normalCall![3] as Record<string, unknown>;
    expect(normalDetails).toMatchObject({
      status: 'disputed',
      from: 'active',
      to: 'disputed',
    });

    // dispute path
    await disputes.openDispute(USER, {
      agreement_id: AGREEMENT_ID,
      opened_by: WALLET,
      reason: 'parity',
    });
    const disputeCall = logActivity.mock.calls.find((c) => c[2] === 'status_changed_to_disputed');
    expect(disputeCall).toBeTruthy();
    const disputeDetails = disputeCall![3] as Record<string, unknown>;
    // same core shape keys as normal flow
    expect(disputeDetails).toMatchObject({
      status: 'disputed',
      from: 'active',
      to: 'disputed',
    });
  });

  it('regression: listByWallet scoping unchanged (creator + participant union)', async () => {
    db.tables.agreements.push({
      id: 'agr-other',
      status: 'pending',
      title: 'Other',
      amount: '1',
      asset: 'USDC',
      created_by: 'GOTHER',
      milestones: [],
    });
    // wallet is only on AGREEMENT_ID as creator/participant
    const { agreements: listed, error } = await agreements.listByWallet(USER, WALLET);
    expect(error).toBeNull();
    const ids = listed.map((a: { id: string }) => a.id);
    expect(ids).toContain(AGREEMENT_ID);
    expect(ids).not.toContain('agr-other');
  });
});
