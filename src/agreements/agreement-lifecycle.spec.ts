/**
 * Agreement Lifecycle Test Suite.
 *
 * Protects the agreement state machine and the business rules that surround
 * it. The valid/invalid transition matrices are DERIVED from
 * AGREEMENT_TRANSITIONS, so introducing a new state (or a new edge) in
 * agreement-lifecycle.ts automatically extends both the unit sweep and the
 * service-level enforcement sweep — no test changes required.
 *
 * Layers:
 *  1. Pure state-machine unit tests (exhaustive matrix + integrity checks).
 *  2. AgreementsService.updateStatus enforcement: transitions, milestone
 *     completion gate, permissions, timestamps, events and activity logging
 *     against a stateful in-memory Supabase.
 *  3. Dispute flows (DisputesService) driving Active → Disputed → Resolved
 *     and the dispute-withdrawn revert to Active.
 */
import 'reflect-metadata';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AgreementsService } from './agreements.service';
import { DisputesService } from '../disputes/disputes.service';
import { UpdateAgreementStatusDto } from './dto/update-status.dto';
import type { SupabaseService } from '../supabase/supabase.service';
import { AGREEMENT_EVENTS } from '../common/events/agreement-events.constants';
import {
  AGREEMENT_STATUSES,
  AGREEMENT_TRANSITIONS,
  TERMINAL_STATUSES,
  type AgreementStatus,
  canTransition,
  invalidTransitionMessage,
  isAgreementStatus,
  isTerminalStatus,
  milestonesSatisfyCompletion,
} from './agreement-lifecycle';

type Row = Record<string, any>;
type Filter = { key: string; op: 'eq' | 'neq' | 'in'; value: any };
type QueryResult = { data: any; error: { message: string; code?: string } | null };

const PAYER_USER = 'lifecycle-user-payer';
const PAYEE_USER = 'lifecycle-user-payee';
const OUTSIDER_USER = 'lifecycle-user-outsider';
const RESOLVER_USER = 'lifecycle-user-resolver';
const WALLETLESS_USER = 'lifecycle-user-walletless';
const PAYER_WALLET = 'GLIFECYCLEPAYER0000000000000000000000000000000000000000';
const PAYEE_WALLET = 'GLIFECYCLEPAYEE0000000000000000000000000000000000000000';
const OUTSIDER_WALLET = 'GLIFECYCLEOUTSIDER00000000000000000000000000000000000';
const RESOLVER_WALLET = 'GLIFECYCLERESOLVER00000000000000000000000000000000000';

class QueryBuilder implements PromiseLike<QueryResult> {
  private filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: any;
  private resultMode: 'many' | 'single' | 'maybeSingle' = 'many';
  private orderBy: { key: string; ascending: boolean } | undefined;
  private rowLimit: number | undefined;

  constructor(
    private readonly db: InMemoryDb,
    private readonly table: string,
  ) {}

  select(_columns = '*') {
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

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    if (this.mode === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map((row) => this.db.insert(this.table, row));
      return { data: this.resultMode === 'many' ? inserted : inserted[0], error: null };
    }
    if (this.mode === 'update') {
      this.db.update(this.table, this.filters, this.payload);
      return { data: null, error: null };
    }

    let rows = this.db.select(this.table, this.filters);
    if (this.orderBy) {
      const { key, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => (a[key] === b[key] ? 0 : a[key] > b[key] ? 1 : -1));
      if (!ascending) rows.reverse();
    }
    if (this.rowLimit !== undefined) rows = rows.slice(0, this.rowLimit);

    if (this.resultMode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
    if (this.resultMode === 'single') {
      return rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
    }
    return { data: rows, error: null };
  }
}

class InMemoryDb {
  tables: Record<string, Row[]> = {};
  private sequence = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.sequence = 0;
    this.tables = {
      auth_users: [
        { id: PAYER_USER, wallet_public_key: PAYER_WALLET },
        { id: PAYEE_USER, wallet_public_key: PAYEE_WALLET },
        { id: OUTSIDER_USER, wallet_public_key: OUTSIDER_WALLET },
        { id: RESOLVER_USER, wallet_public_key: RESOLVER_WALLET },
        { id: WALLETLESS_USER, wallet_public_key: null },
      ],
      profiles: [],
      agreements: [],
      agreement_participants: [],
      agreement_activity: [],
      disputes: [],
      dispute_resolutions: [],
    };
  }

  getClient() {
    return { from: (table: string) => new QueryBuilder(this, table) };
  }

  insert(table: string, row: Row) {
    this.sequence += 1;
    const inserted = {
      id: row.id ?? `${table}-${this.sequence}`,
      created_at: new Date(Date.UTC(2026, 6, 18, 0, 0, this.sequence)).toISOString(),
      ...row,
    };
    this.tables[table] = [...(this.tables[table] ?? []), inserted];
    return { ...inserted };
  }

  update(table: string, filters: Filter[], payload: Row) {
    this.tables[table] = (this.tables[table] ?? []).map((row) =>
      this.matches(row, filters) ? { ...row, ...payload } : row,
    );
  }

  select(table: string, filters: Filter[]) {
    return (this.tables[table] ?? [])
      .filter((row) => this.matches(row, filters))
      .map((r) => ({
        ...r,
      }));
  }

  agreement(id: string): Row {
    const row = this.tables.agreements.find((a) => a.id === id);
    if (!row) throw new Error(`agreement ${id} not seeded`);
    return row;
  }

  activityFor(id: string): Row[] {
    return this.tables.agreement_activity.filter((a) => a.agreement_id === id);
  }

  private matches(row: Row, filters: Filter[]) {
    return filters.every((f) => {
      if (f.op === 'eq') return row[f.key] === f.value;
      if (f.op === 'neq') return row[f.key] !== f.value;
      if (f.op === 'in') return f.value.includes(row[f.key]);
      return true;
    });
  }
}

/** Every declared (valid) edge in the machine, derived from the map. */
const VALID_TRANSITIONS: Array<[AgreementStatus, AgreementStatus]> = AGREEMENT_STATUSES.flatMap(
  (from) =>
    AGREEMENT_TRANSITIONS[from].map((to) => [from, to] as [AgreementStatus, AgreementStatus]),
);

/** Every undeclared (invalid) pair, including self-transitions. */
const INVALID_TRANSITIONS: Array<[AgreementStatus, AgreementStatus]> = AGREEMENT_STATUSES.flatMap(
  (from) =>
    AGREEMENT_STATUSES.filter((to) => !AGREEMENT_TRANSITIONS[from].includes(to)).map(
      (to) => [from, to] as [AgreementStatus, AgreementStatus],
    ),
);

describe('Agreement lifecycle state machine (unit)', () => {
  describe('documented lifecycle transitions are permitted', () => {
    const documented: Array<[AgreementStatus, AgreementStatus, string]> = [
      ['draft', 'pending', 'Draft → Pending Funding'],
      ['pending', 'funded', 'Pending Funding → Funded (escrow deposit recorded)'],
      ['pending', 'active', 'Pending Funding → Active'],
      ['funded', 'active', 'Funded → Active (work begins)'],
      ['active', 'in_review', 'Active → In Review'],
      ['in_review', 'completed', 'In Review → Completed'],
      ['in_review', 'active', 'In Review → Active (changes requested)'],
      ['active', 'cancelled', 'Active → Cancelled'],
      ['active', 'disputed', 'Active → Disputed'],
      ['disputed', 'resolved', 'Disputed → Resolved'],
      ['disputed', 'active', 'Disputed → Active (dispute withdrawn)'],
    ];

    it.each(documented)('%s → %s (%s)', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });
  });

  describe('exhaustive transition matrix', () => {
    it.each(INVALID_TRANSITIONS)('forbids %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });

    it('covers every status pair exactly once', () => {
      expect(VALID_TRANSITIONS.length + INVALID_TRANSITIONS.length).toBe(
        AGREEMENT_STATUSES.length * AGREEMENT_STATUSES.length,
      );
    });
  });

  describe('terminal states', () => {
    it('completed, resolved and cancelled are terminal', () => {
      expect([...TERMINAL_STATUSES].sort()).toEqual(['cancelled', 'completed', 'resolved']);
    });

    it.each(TERMINAL_STATUSES.map((s) => [s]))('%s has no outgoing transitions', (status) => {
      expect(isTerminalStatus(status)).toBe(true);
      expect(AGREEMENT_TRANSITIONS[status]).toHaveLength(0);
    });
  });

  describe('machine integrity (guards future state additions)', () => {
    it('declares an outgoing-transition entry for every status', () => {
      expect(Object.keys(AGREEMENT_TRANSITIONS).sort()).toEqual([...AGREEMENT_STATUSES].sort());
    });

    it('only targets declared statuses', () => {
      for (const from of AGREEMENT_STATUSES) {
        for (const to of AGREEMENT_TRANSITIONS[from]) {
          expect(isAgreementStatus(to)).toBe(true);
        }
      }
    });

    it('never declares a self-transition', () => {
      for (const from of AGREEMENT_STATUSES) {
        expect(AGREEMENT_TRANSITIONS[from]).not.toContain(from);
      }
    });

    it('every status is reachable from draft', () => {
      const reachable = new Set<AgreementStatus>(['draft']);
      const queue: AgreementStatus[] = ['draft'];
      while (queue.length) {
        for (const next of AGREEMENT_TRANSITIONS[queue.shift()!]) {
          if (!reachable.has(next)) {
            reachable.add(next);
            queue.push(next);
          }
        }
      }
      expect([...reachable].sort()).toEqual([...AGREEMENT_STATUSES].sort());
    });
  });

  describe('unknown statuses', () => {
    it('rejects transitions involving unknown statuses', () => {
      expect(canTransition('archived', 'active')).toBe(false);
      expect(canTransition('active', 'archived')).toBe(false);
      expect(canTransition(undefined, 'active')).toBe(false);
      expect(isAgreementStatus('archived')).toBe(false);
    });

    it('explains why a transition was rejected', () => {
      expect(invalidTransitionMessage('completed', 'active')).toContain('terminal');
      expect(invalidTransitionMessage('archived', 'active')).toContain('unknown status');
      expect(invalidTransitionMessage('active', 'archived')).toContain('not a valid');
      expect(invalidTransitionMessage('pending', 'completed')).toContain(
        'Invalid status transition',
      );
    });
  });

  describe('milestone completion rule', () => {
    it('accepts agreements without milestones', () => {
      expect(milestonesSatisfyCompletion([])).toBe(true);
      expect(milestonesSatisfyCompletion(null)).toBe(true);
      expect(milestonesSatisfyCompletion(undefined)).toBe(true);
    });

    it('accepts approved and released milestones', () => {
      expect(milestonesSatisfyCompletion([{ status: 'approved' }, { status: 'released' }])).toBe(
        true,
      );
    });

    it('rejects when any milestone is still pending', () => {
      expect(milestonesSatisfyCompletion([{ status: 'approved' }, { status: 'pending' }])).toBe(
        false,
      );
      expect(milestonesSatisfyCompletion([{}])).toBe(false);
    });
  });

  describe('UpdateAgreementStatusDto stays in sync with the machine', () => {
    it.each(AGREEMENT_STATUSES.map((s) => [s]))('accepts status "%s"', async (status) => {
      const dto = plainToInstance(UpdateAgreementStatusDto, {
        status,
        actor_wallet: PAYER_WALLET,
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejects statuses outside the machine vocabulary', async () => {
      const dto = plainToInstance(UpdateAgreementStatusDto, {
        status: 'archived',
        actor_wallet: PAYER_WALLET,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

describe('AgreementsService lifecycle enforcement (business rules)', () => {
  let db: InMemoryDb;
  let emit: jest.Mock;
  let service: AgreementsService;
  let agreementCounter = 0;

  const APPROVED_MILESTONES = [
    { description: 'Design', amount: '50.00', status: 'approved' },
    { description: 'Build', amount: '50.00', status: 'released' },
  ];

  beforeEach(() => {
    db = new InMemoryDb();
    emit = jest.fn();
    service = new AgreementsService(
      db as unknown as SupabaseService,
      { emit } as unknown as EventEmitter2,
    );
  });

  function seedAgreement(status: AgreementStatus, overrides: Row = {}): string {
    agreementCounter += 1;
    const id = `agr-${agreementCounter}`;
    db.insert('agreements', {
      id,
      contract_id: `contract-${agreementCounter}`,
      title: 'Lifecycle test agreement',
      amount: '100.00',
      asset: 'USDC',
      status,
      created_by: PAYER_WALLET,
      milestones: APPROVED_MILESTONES,
      metadata: {},
      ...overrides,
    });
    db.insert('agreement_participants', {
      agreement_id: id,
      wallet_address: PAYER_WALLET,
      role: 'payer',
    });
    db.insert('agreement_participants', {
      agreement_id: id,
      wallet_address: PAYEE_WALLET,
      role: 'payee',
    });
    return id;
  }

  const move = (id: string, status: string, userId = PAYER_USER, wallet = PAYER_WALLET) =>
    service.updateStatus(userId, id, { status, actor_wallet: wallet });

  describe('every declared transition is accepted and persisted', () => {
    it.each(VALID_TRANSITIONS)('allows %s → %s', async (from, to) => {
      const id = seedAgreement(from);
      const result = await move(id, to);

      expect(result).toEqual({ success: true, error: null });
      expect(db.agreement(id).status).toBe(to);
      expect(db.activityFor(id)).toEqual([
        expect.objectContaining({
          action: `status_changed_to_${to}`,
          actor_wallet: PAYER_WALLET,
          details: expect.objectContaining({ from, to }),
        }),
      ]);
    });
  });

  describe('every undeclared transition is rejected without side effects', () => {
    it.each(INVALID_TRANSITIONS)('rejects %s → %s', async (from, to) => {
      const id = seedAgreement(from);

      await expect(move(id, to)).rejects.toThrow(BadRequestException);
      await expect(move(id, to)).rejects.toThrow(invalidTransitionMessage(from, to));

      expect(db.agreement(id).status).toBe(from);
      expect(db.activityFor(id)).toHaveLength(0);
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('full happy-path lifecycle', () => {
    it('walks draft → pending → funded → active → in_review → completed', async () => {
      const id = seedAgreement('draft');

      for (const status of ['pending', 'funded', 'active', 'in_review', 'completed']) {
        const result = await move(id, status);
        expect(result.success).toBe(true);
        expect(db.agreement(id).status).toBe(status);
      }

      const row = db.agreement(id);
      expect(row.funded_at).toBeDefined();
      expect(row.completed_at).toBeDefined();
      expect(row.updated_at).toBeDefined();

      expect(db.activityFor(id).map((a) => a.action)).toEqual([
        'status_changed_to_pending',
        'status_changed_to_funded',
        'status_changed_to_active',
        'status_changed_to_in_review',
        'status_changed_to_completed',
      ]);
    });

    it('emits FUNDED when the agreement is funded', async () => {
      const id = seedAgreement('pending');
      await move(id, 'funded');

      expect(emit).toHaveBeenCalledWith(AGREEMENT_EVENTS.FUNDED, {
        agreementId: id,
        title: 'Lifecycle test agreement',
        amount: '100.00',
        asset: 'USDC',
        fundedByWallet: PAYER_WALLET,
      });
      expect(db.agreement(id).funded_at).toBeDefined();
    });

    it('emits COMPLETED when the agreement completes or resolves', async () => {
      const completedId = seedAgreement('in_review');
      await move(completedId, 'completed');
      expect(emit).toHaveBeenCalledWith(
        AGREEMENT_EVENTS.COMPLETED,
        expect.objectContaining({ agreementId: completedId, totalAmount: '100.00' }),
      );

      emit.mockClear();
      const resolvedId = seedAgreement('disputed');
      await move(resolvedId, 'resolved');
      expect(emit).toHaveBeenCalledWith(
        AGREEMENT_EVENTS.COMPLETED,
        expect.objectContaining({ agreementId: resolvedId }),
      );
      expect(db.agreement(resolvedId).completed_at).toBeDefined();
    });

    it('does not emit lifecycle events for intermediate transitions', async () => {
      const id = seedAgreement('active');
      await move(id, 'in_review');
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('milestone completion requirements', () => {
    it('blocks completion while a milestone is unfinished', async () => {
      const id = seedAgreement('in_review', {
        milestones: [
          { description: 'Design', amount: '50.00', status: 'approved' },
          { description: 'Build', amount: '50.00', status: 'pending' },
        ],
      });

      await expect(move(id, 'completed')).rejects.toThrow(
        'All milestones must be approved or released before the agreement can be completed',
      );
      expect(db.agreement(id).status).toBe('in_review');
      expect(db.agreement(id).completed_at).toBeUndefined();
      expect(emit).not.toHaveBeenCalled();
    });

    it('allows completion once every milestone is approved or released', async () => {
      const id = seedAgreement('in_review', {
        milestones: [{ description: 'Build', amount: '100.00', status: 'pending' }],
      });

      await service.updateMilestone(PAYER_USER, id, {
        milestone_index: 0,
        status: 'approved',
        actor_wallet: PAYER_WALLET,
      });

      const result = await move(id, 'completed');
      expect(result.success).toBe(true);
      expect(db.agreement(id).status).toBe('completed');
    });

    it('allows agreements without milestones to complete', async () => {
      const id = seedAgreement('in_review', { milestones: [] });
      const result = await move(id, 'completed');
      expect(result.success).toBe(true);
    });

    it('does not apply the milestone gate to dispute resolution', async () => {
      const id = seedAgreement('disputed', {
        milestones: [{ description: 'Build', amount: '100.00', status: 'pending' }],
      });
      const result = await move(id, 'resolved');
      expect(result.success).toBe(true);
      expect(db.agreement(id).status).toBe('resolved');
    });
  });

  describe('permission checks', () => {
    it('lets any participant (not only the creator) transition the agreement', async () => {
      const id = seedAgreement('active');
      const result = await move(id, 'in_review', PAYEE_USER, PAYEE_WALLET);
      expect(result.success).toBe(true);
      expect(db.agreement(id).status).toBe('in_review');
    });

    it('rejects users that are not participants of the agreement', async () => {
      const id = seedAgreement('active');
      await expect(move(id, 'cancelled', OUTSIDER_USER, OUTSIDER_WALLET)).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.agreement(id).status).toBe('active');
      expect(db.activityFor(id)).toHaveLength(0);
    });

    it('rejects an actor_wallet that does not belong to the authenticated user', async () => {
      const id = seedAgreement('active');
      await expect(move(id, 'cancelled', PAYER_USER, PAYEE_WALLET)).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.agreement(id).status).toBe('active');
    });

    it('rejects users without a wallet on file', async () => {
      const id = seedAgreement('active');
      await expect(move(id, 'cancelled', WALLETLESS_USER, PAYER_WALLET)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns 404 for unknown agreements', async () => {
      await expect(move('agr-missing', 'active')).rejects.toThrow(NotFoundException);
    });
  });

  describe('activity logging during transitions', () => {
    it('records one audit entry per transition with from/to details', async () => {
      const id = seedAgreement('pending');
      await move(id, 'funded');
      await move(id, 'active', PAYEE_USER, PAYEE_WALLET);
      await move(id, 'cancelled');

      expect(db.activityFor(id)).toEqual([
        expect.objectContaining({
          action: 'status_changed_to_funded',
          actor_wallet: PAYER_WALLET,
          details: expect.objectContaining({ from: 'pending', to: 'funded' }),
        }),
        expect.objectContaining({
          action: 'status_changed_to_active',
          actor_wallet: PAYEE_WALLET,
          details: expect.objectContaining({ from: 'funded', to: 'active' }),
        }),
        expect.objectContaining({
          action: 'status_changed_to_cancelled',
          actor_wallet: PAYER_WALLET,
          details: expect.objectContaining({ from: 'active', to: 'cancelled' }),
        }),
      ]);
    });

    it('exposes the audit trail through getActivity, newest first', async () => {
      const id = seedAgreement('pending');
      await move(id, 'funded');
      await move(id, 'active');

      const { activities, error } = await service.getActivity(PAYER_USER, id);
      expect(error).toBeNull();
      expect(activities.map((a: Row) => a.action)).toEqual([
        'status_changed_to_active',
        'status_changed_to_funded',
      ]);
    });
  });

  describe('extended activity logging: previous/new state + milestone actions (issue #61)', () => {
    it('records previous_state and new_state on a status transition', async () => {
      const id = seedAgreement('pending');
      await move(id, 'funded');

      expect(db.activityFor(id)).toEqual([
        expect.objectContaining({
          action: 'status_changed_to_funded',
          actor_wallet: PAYER_WALLET,
          previous_state: 'pending',
          new_state: 'funded',
          details: expect.objectContaining({ from: 'pending', to: 'funded' }),
        }),
      ]);
    });

    it('records previous_state and new_state on a milestone transition', async () => {
      const id = seedAgreement('active', {
        milestones: [{ description: 'Build', amount: '100.00', status: 'pending' }],
      });

      const result = await service.updateMilestone(PAYER_USER, id, {
        milestone_index: 0,
        status: 'approved',
        actor_wallet: PAYER_WALLET,
      });

      expect(result).toEqual({ success: true, error: null });
      expect(db.activityFor(id)).toEqual([
        expect.objectContaining({
          action: 'milestone_approved',
          previous_state: 'pending',
          new_state: 'approved',
        }),
      ]);
    });

    it('logs the discrete milestone_rejected action with its state transition', async () => {
      const id = seedAgreement('active', {
        milestones: [{ description: 'Build', amount: '100.00', status: 'approved' }],
      });

      await service.updateMilestone(PAYER_USER, id, {
        milestone_index: 0,
        status: 'rejected',
        actor_wallet: PAYER_WALLET,
      });

      expect(db.activityFor(id)).toEqual([
        expect.objectContaining({
          action: 'milestone_rejected',
          previous_state: 'approved',
          new_state: 'rejected',
        }),
      ]);
    });

    it('logs milestone_created per milestone at creation; non-transition entries keep null state', async () => {
      const { agreement, error } = await service.create(PAYER_USER, {
        created_by: PAYER_WALLET,
        title: 'Agreement with milestones',
        amount: '100.00',
        participants: [
          { wallet_address: PAYER_WALLET, role: 'payer' },
          { wallet_address: PAYEE_WALLET, role: 'payee' },
        ],
        milestones: [
          { description: 'Design', amount: '50.00', status: 'pending' },
          { description: 'Build', amount: '50.00', status: 'pending' },
        ],
      });

      expect(error).toBeNull();
      const acts = db.activityFor(agreement!.id);
      expect(acts.map((a: Row) => a.action)).toEqual([
        'created',
        'milestone_created',
        'milestone_created',
      ]);
      // The generic 'created' entry is not a state transition.
      expect(acts[0]).toEqual(
        expect.objectContaining({ action: 'created', previous_state: null, new_state: null }),
      );
      expect(acts[1]).toEqual(
        expect.objectContaining({
          action: 'milestone_created',
          new_state: 'pending',
          details: expect.objectContaining({ milestone_index: 0 }),
        }),
      );
    });

    it('preserves the existing details payload (from/to) on transitions for backward compatibility', async () => {
      const id = seedAgreement('pending');
      await move(id, 'funded');

      const entry = db.activityFor(id)[0];
      // Existing consumers that read details.from / details.to keep working, and
      // the new columns are additive.
      expect(entry.details).toEqual(
        expect.objectContaining({ status: 'funded', from: 'pending', to: 'funded' }),
      );
      expect(entry).toEqual(
        expect.objectContaining({ previous_state: 'pending', new_state: 'funded' }),
      );
    });
  });
});

describe('Dispute flows drive the agreement lifecycle', () => {
  let db: InMemoryDb;
  let emit: jest.Mock;
  let agreements: AgreementsService;
  let disputes: DisputesService;
  const AGREEMENT_ID = 'agr-dispute-1';

  beforeEach(() => {
    db = new InMemoryDb();
    emit = jest.fn();
    const emitter = { emit } as unknown as EventEmitter2;
    agreements = new AgreementsService(db as unknown as SupabaseService, emitter);
    disputes = new DisputesService(db as unknown as SupabaseService, agreements, emitter);

    db.insert('agreements', {
      id: AGREEMENT_ID,
      contract_id: 'contract-dispute-1',
      title: 'Disputed agreement',
      amount: '100.00',
      asset: 'USDC',
      status: 'active',
      created_by: PAYER_WALLET,
      milestones: [],
      metadata: {},
    });
    db.insert('agreement_participants', {
      agreement_id: AGREEMENT_ID,
      wallet_address: PAYER_WALLET,
      role: 'payer',
    });
    db.insert('agreement_participants', {
      agreement_id: AGREEMENT_ID,
      wallet_address: PAYEE_WALLET,
      role: 'payee',
    });
  });

  async function openDispute() {
    const { dispute, error } = await disputes.openDispute(PAYER_USER, {
      agreement_id: AGREEMENT_ID,
      opened_by: PAYER_WALLET,
      reason: 'Deliverable does not match scope',
      evidence_urls: [],
    });
    expect(error).toBeNull();
    return dispute!.id;
  }

  it('opening a dispute moves the agreement to disputed and logs it', async () => {
    const disputeId = await openDispute();

    expect(db.agreement(AGREEMENT_ID).status).toBe('disputed');
    expect(db.activityFor(AGREEMENT_ID)).toEqual([
      expect.objectContaining({
        action: 'dispute_opened',
        details: expect.objectContaining({ dispute_id: disputeId }),
      }),
    ]);
  });

  it('records dispute open/resolve in the agreement timeline with previous/new state (issue #61)', async () => {
    const disputeId = await openDispute();
    await disputes.assignResolver(PAYER_USER, disputeId, { resolver_wallet: RESOLVER_WALLET });
    await disputes.resolveDispute(RESOLVER_USER, disputeId, {
      resolved_by: RESOLVER_WALLET,
      payer_percentage: 50,
      payee_percentage: 50,
      resolution_notes: 'Split evenly',
    });

    const timeline = db.activityFor(AGREEMENT_ID);
    // Dispute lifecycle events live in the SAME agreement timeline (deduped logger).
    expect(timeline.map((a: Row) => a.action)).toEqual([
      'dispute_opened',
      'dispute_resolver_assigned',
      'dispute_resolved',
    ]);
    expect(timeline[0]).toEqual(
      expect.objectContaining({
        action: 'dispute_opened',
        previous_state: 'active',
        new_state: 'disputed',
      }),
    );
    expect(timeline[2]).toEqual(
      expect.objectContaining({
        action: 'dispute_resolved',
        previous_state: 'disputed',
        new_state: 'resolved',
      }),
    );
  });

  it('outsiders cannot open disputes', async () => {
    await expect(
      disputes.openDispute(OUTSIDER_USER, {
        agreement_id: AGREEMENT_ID,
        opened_by: OUTSIDER_WALLET,
        reason: 'Not my agreement',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(db.agreement(AGREEMENT_ID).status).toBe('active');
  });

  it('resolving a dispute moves the agreement to resolved (terminal)', async () => {
    const disputeId = await openDispute();
    await disputes.assignResolver(PAYER_USER, disputeId, { resolver_wallet: RESOLVER_WALLET });

    const { resolution, error } = await disputes.resolveDispute(RESOLVER_USER, disputeId, {
      resolved_by: RESOLVER_WALLET,
      payer_percentage: 40,
      payee_percentage: 60,
      resolution_notes: 'Partial delivery accepted',
    });

    expect(error).toBeNull();
    expect(resolution).toBeDefined();
    expect(db.agreement(AGREEMENT_ID).status).toBe('resolved');
    expect(db.agreement(AGREEMENT_ID).completed_at).toBeDefined();
    expect(db.activityFor(AGREEMENT_ID).map((a) => a.action)).toEqual([
      'dispute_opened',
      'dispute_resolver_assigned',
      'dispute_resolved',
    ]);

    // The lifecycle machine agrees resolved is terminal: nothing may follow.
    await expect(
      agreements.updateStatus(PAYER_USER, AGREEMENT_ID, {
        status: 'active',
        actor_wallet: PAYER_WALLET,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('withdrawing a dispute reverts the agreement to active', async () => {
    const disputeId = await openDispute();
    const { success, error } = await disputes.cancelDispute(PAYER_USER, disputeId, {
      cancelled_by: PAYER_WALLET,
    });

    expect(error).toBeNull();
    expect(success).toBe(true);
    expect(db.agreement(AGREEMENT_ID).status).toBe('active');
    expect(canTransition('disputed', 'active')).toBe(true);
  });
});
