/**
 * Regression: issue #59 / #67 · PR #110 / #76
 * Bug: illegal agreement status transitions were accepted (or terminal states mutated).
 */
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgreementsService } from './agreements.service';
import { AgreementActivityService } from './agreement-activity.service';
import { canTransition, invalidTransitionMessage } from './agreement-lifecycle';
import { validateTransition } from './agreement.validator';

type Row = Record<string, unknown>;

function buildDb(agreements: Row[], authUsers: Row[]) {
  const tables: Record<string, Row[]> = {
    agreements: agreements.map((r) => ({ ...r })),
    auth_users: authUsers.map((r) => ({ ...r })),
    agreement_participants: [],
    agreement_activity: [],
  };

  function chain(table: string) {
    const rows = tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    let mode: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | null = null;
    let wantSingle = false;

    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = () => self();
    api.eq = (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return self();
    };
    api.insert = (data: Row) => {
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
    api.maybeSingle = () => finalize();

    const finalize = () => {
      if (mode === 'insert') {
        tables[table].push({ id: `${table}-${tables[table].length + 1}`, ...payload });
        return Promise.resolve({ data: payload, error: null });
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === 'update') {
        matched = matched.map((r) => Object.assign(r, payload));
      }
      if (wantSingle) {
        const data = matched[0] ?? null;
        if (!data) return Promise.resolve({ data: null, error: { message: 'not found' } });
        return Promise.resolve({ data, error: null });
      }
      return Promise.resolve({ data: matched[0] ?? null, error: null });
    };

    (api as { then?: unknown }).then = (resolve: (v: unknown) => unknown) =>
      finalize().then(resolve);
    return api;
  }

  return { tables, client: { from: (t: string) => chain(t) } };
}

describe('regression: illegal status transitions blocked (issue #59 / #67 · PR #110 / #76)', () => {
  it('blocks pending → completed at the lifecycle + validator layer', () => {
    expect(canTransition('pending', 'completed')).toBe(false);
    expect(invalidTransitionMessage('pending', 'completed')).toMatch(/Invalid status transition/);

    const result = validateTransition('pending', 'completed');
    expect(result.success).toBe(false);
    expect(result.error?.details[0]?.code).toBe('INVALID_TRANSITION');
  });

  it('blocks transitions out of terminal completed', () => {
    expect(canTransition('completed', 'active')).toBe(false);
    expect(invalidTransitionMessage('completed', 'active')).toMatch(/terminal/i);

    const result = validateTransition('completed', 'active');
    expect(result.success).toBe(false);
  });

  it('AgreementsService.updateStatus rejects pending → completed', async () => {
    const db = buildDb(
      [
        {
          id: 'agr-1',
          status: 'pending',
          title: 'T',
          amount: '100',
          asset: 'USDC',
          created_by: 'GWALLET',
          milestones: [],
        },
      ],
      [{ id: 'user-1', wallet_public_key: 'GWALLET' }],
    );
    const supabase = { getClient: () => db.client } as never;
    const activity = new AgreementActivityService(supabase);
    const svc = new AgreementsService(
      supabase,
      new EventEmitter2(),
      activity,
      {
        syncMilestone: jest.fn().mockResolvedValue({ success: true }),
        syncStatusTransition: jest.fn().mockResolvedValue({ synced: true }),
        validateContractOnTrustless: jest.fn().mockResolvedValue({ valid: true }),
      } as never,
      { validateTransition: jest.fn().mockReturnValue({ valid: true }) } as never,
    );

    await expect(
      svc.updateStatus('user-1', 'agr-1', { actor_wallet: 'GWALLET', status: 'completed' }),
    ).rejects.toThrow(BadRequestException);

    expect(db.tables.agreements[0].status).toBe('pending');
  });
});
