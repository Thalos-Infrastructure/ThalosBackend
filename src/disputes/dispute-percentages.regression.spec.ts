/**
 * Regression: issue #12 / PR #49
 * Bug: dispute resolution accepted payer_percentage + payee_percentage ≠ 100.
 */
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DisputesService } from './disputes.service';
import { AgreementsService } from '../agreements/agreements.service';
import { AgreementActivityService } from '../agreements/agreement-activity.service';
import { AgreementValidationService } from '../agreements/validation/agreement-validation.service';

type Row = Record<string, unknown>;

function buildDb(seed: {
  agreements: Row[];
  auth_users?: Row[];
  disputes?: Row[];
  dispute_resolutions?: Row[];
  agreement_activity?: Row[];
}) {
  const tables: Record<string, Row[]> = {
    agreements: seed.agreements.map((r) => ({ ...r })),
    auth_users: (seed.auth_users ?? []).map((r) => ({ ...r })),
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

  return {
    tables,
    client: { from: (table: string) => chain(table) },
  };
}

describe('regression: dispute percentage validation (issue #12 / PR #49)', () => {
  const RESOLVER = 'GWALLET-RESOLVER';
  const USER_RESOLVER = 'user-resolver';

  it('rejects resolve when payer_percentage + payee_percentage !== 100', async () => {
    const db = buildDb({
      agreements: [
        {
          id: 'agr-1',
          status: 'disputed',
          title: 'T',
          amount: '100',
          asset: 'USDC',
          created_by: 'GWALLET-PAYER',
        },
      ],
      auth_users: [{ id: USER_RESOLVER, wallet_public_key: RESOLVER }],
      disputes: [
        {
          id: 'disp-1',
          agreement_id: 'agr-1',
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

    await expect(
      disputes.resolveDispute(USER_RESOLVER, 'disp-1', {
        resolved_by: RESOLVER,
        payer_percentage: 45,
        payee_percentage: 40,
        resolution_notes: 'bad split',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      disputes.resolveDispute(USER_RESOLVER, 'disp-1', {
        resolved_by: RESOLVER,
        payer_percentage: 45,
        payee_percentage: 40,
        resolution_notes: 'bad split',
      }),
    ).rejects.toThrow(/Percentages must sum to 100%/);

    expect(db.tables.dispute_resolutions).toHaveLength(0);
    expect(db.tables.disputes[0].status).toBe('under_review');
  });
});
