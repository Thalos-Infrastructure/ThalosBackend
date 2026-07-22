import { ConflictException, NotFoundException } from '@nestjs/common';
import { RetryQueueService } from './retry-queue.service';
import { computeBackoffMs } from './retry-queue.constants';
import { RetryJobStatus, RetryJobType } from './retry-queue.types';

// ---------------------------------------------------------------------------
// A minimal, stateful fake of the Supabase query surface RetryQueueService
// uses (insert/select/update/eq/lte/order/limit/single/maybeSingle), backed
// by an in-memory Map so behavior (idempotency, persistence across a
// simulated "restart") matches what real Postgres would do. Modeled after
// the InMemorySupabase fixture in src/integration/migrated-flows.integration.spec.ts.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;
type Filter = { key: string; op: 'eq' | 'lte'; value: any };

class FakeRetryJobsStore {
  readonly rows = new Map<string, Row>();
  private seq = 1;

  getClient() {
    return { from: (table: string) => new FakeQueryBuilder(this, table) };
  }

  insert(row: Row): { data: Row | null; error: { code?: string; message: string } | null } {
    const duplicate = [...this.rows.values()].find(
      (r) => r.idempotency_key === row.idempotency_key,
    );
    if (duplicate) {
      return {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      };
    }
    const id = row.id ?? `job-${this.seq++}`;
    const now = new Date().toISOString();
    const full: Row = {
      created_at: now,
      updated_at: now,
      completed_at: null,
      last_error: null,
      ...row,
      id,
    };
    this.rows.set(id, full);
    return { data: { ...full }, error: null };
  }

  update(id: string, updates: Row): { data: Row | null; error: { message: string } | null } {
    const existing = this.rows.get(id);
    if (!existing) return { data: null, error: { message: `job ${id} not found` } };
    const merged = { ...existing, ...updates };
    this.rows.set(id, merged);
    return { data: { ...merged }, error: null };
  }

  select(filters: Filter[]): Row[] {
    return [...this.rows.values()].filter((row) =>
      filters.every((f) => (f.op === 'eq' ? row[f.key] === f.value : row[f.key] <= f.value)),
    );
  }
}

class FakeQueryBuilder implements PromiseLike<{ data: any; error: any }> {
  private mode: 'select' | 'insert' | 'update' = 'select';
  private filters: Filter[] = [];
  private payload: Row | undefined;
  private wantsSingle = false;

  constructor(
    private readonly store: FakeRetryJobsStore,
    private readonly _table: string,
  ) {}

  insert(payload: Row) {
    this.mode = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.mode = 'update';
    this.payload = payload;
    return this;
  }

  select(_columns?: string) {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, op: 'eq', value });
    return this;
  }

  lte(key: string, value: unknown) {
    this.filters.push({ key, op: 'lte', value });
    return this;
  }

  order(_key?: string, _opts?: unknown) {
    return this;
  }

  limit(_n?: number) {
    return this;
  }

  single() {
    this.wantsSingle = true;
    return this;
  }

  maybeSingle() {
    this.wantsSingle = true;
    return this;
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }

  private exec(): { data: any; error: any } {
    if (this.mode === 'insert') return this.store.insert(this.payload!);
    if (this.mode === 'update') {
      const idFilter = this.filters.find((f) => f.key === 'id' && f.op === 'eq');
      if (!idFilter) return { data: null, error: { message: 'update requires an id filter' } };
      return this.store.update(idFilter.value, this.payload!);
    }
    const rows = this.store.select(this.filters);
    if (this.wantsSingle) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

// ---------------------------------------------------------------------------

function buildService(store: FakeRetryJobsStore, overrides: Record<string, string> = {}) {
  const config = {
    get: (key: string, def?: string) => overrides[key] ?? def,
  };
  return new (RetryQueueService as unknown as new (...args: unknown[]) => RetryQueueService)(
    store,
    config,
  );
}

// ---------------------------------------------------------------------------
// computeBackoffMs — pure backoff schedule
// ---------------------------------------------------------------------------
describe('computeBackoffMs', () => {
  it('doubles the delay on each successive attempt', () => {
    expect(computeBackoffMs(1, 1000, 60_000)).toBe(1000);
    expect(computeBackoffMs(2, 1000, 60_000)).toBe(2000);
    expect(computeBackoffMs(3, 1000, 60_000)).toBe(4000);
    expect(computeBackoffMs(4, 1000, 60_000)).toBe(8000);
  });

  it('caps the delay at maxDelayMs', () => {
    expect(computeBackoffMs(10, 1000, 60_000)).toBe(60_000);
  });

  it('never returns a delay below zero for attempt 0', () => {
    expect(computeBackoffMs(0, 1000, 60_000)).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// enqueue — idempotency / duplicate prevention
// ---------------------------------------------------------------------------
describe('RetryQueueService.enqueue — idempotency', () => {
  it('enqueuing the same idempotency key twice creates only one job', async () => {
    const store = new FakeRetryJobsStore();
    const svc = buildService(store);

    const first = await svc.enqueue(RetryJobType.PAYMENT_EXECUTION, { amount: 10 }, 'key-1');
    const second = await svc.enqueue(RetryJobType.PAYMENT_EXECUTION, { amount: 10 }, 'key-1');

    expect(second.id).toBe(first.id);
    expect(store.rows.size).toBe(1);
  });

  it('executes the handler only once when a duplicate is processed', async () => {
    const store = new FakeRetryJobsStore();
    const svc = buildService(store);
    const handler = jest.fn().mockResolvedValue(undefined);
    svc.registerHandler(RetryJobType.PAYMENT_EXECUTION, handler);

    await svc.enqueue(RetryJobType.PAYMENT_EXECUTION, { amount: 10 }, 'key-dup');
    await svc.enqueue(RetryJobType.PAYMENT_EXECUTION, { amount: 10 }, 'key-dup');
    await svc.processDueJobs();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('different idempotency keys create separate jobs', async () => {
    const store = new FakeRetryJobsStore();
    const svc = buildService(store);

    await svc.enqueue(RetryJobType.PAYMENT_EXECUTION, {}, 'key-a');
    await svc.enqueue(RetryJobType.PAYMENT_EXECUTION, {}, 'key-b');

    expect(store.rows.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// processJob / processDueJobs — retry with backoff, eventual success or failure
// ---------------------------------------------------------------------------
describe('RetryQueueService.processDueJobs — retry with backoff', () => {
  it('retries a failing handler and eventually succeeds, applying backoff between attempts', async () => {
    const store = new FakeRetryJobsStore();
    const svc = buildService(store, {
      RETRY_QUEUE_BASE_DELAY_MS: '1000',
      RETRY_QUEUE_MAX_DELAY_MS: '60000',
    });

    let calls = 0;
    const handler = jest.fn().mockImplementation(() => {
      calls += 1;
      if (calls < 3) throw new Error('transient TW outage');
      return Promise.resolve();
    });
    svc.registerHandler(RetryJobType.STATUS_SYNC, handler);

    const job = await svc.enqueue(RetryJobType.STATUS_SYNC, { contractId: 'c-1' }, 'sync-1', {
      maxAttempts: 5,
    });

    // Attempt 1: fails, scheduled for later — not picked up on the next immediate poll.
    await svc.processJob(job);
    let stored = await svc.getJob(job.id);
    expect(stored?.status).toBe(RetryJobStatus.PENDING);
    expect(stored?.attempts).toBe(1);
    expect(stored?.last_error).toContain('transient TW outage');
    expect(new Date(stored!.next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    // Attempt 2: still fails, backoff grows (2x base).
    stored = await svc.processJob(stored!);
    expect(stored.status).toBe(RetryJobStatus.PENDING);
    expect(stored.attempts).toBe(2);

    // Attempt 3: succeeds.
    stored = await svc.processJob(stored);
    expect(stored.status).toBe(RetryJobStatus.SUCCEEDED);
    expect(stored.attempts).toBe(3);
    expect(stored.completed_at).not.toBeNull();
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('marks the job failed once max attempts are exhausted', async () => {
    const store = new FakeRetryJobsStore();
    const svc = buildService(store);

    const handler = jest.fn().mockRejectedValue(new Error('permanent TW error'));
    svc.registerHandler(RetryJobType.CONTRACT_RETRIEVAL, handler);

    let job = await svc.enqueue(
      RetryJobType.CONTRACT_RETRIEVAL,
      { contractId: 'c-2' },
      'retrieve-1',
      { maxAttempts: 3 },
    );

    for (let i = 0; i < 3; i++) {
      job = await svc.processJob(job);
    }

    expect(job.status).toBe(RetryJobStatus.FAILED);
    expect(job.attempts).toBe(3);
    expect(job.last_error).toContain('permanent TW error');
    expect(handler).toHaveBeenCalledTimes(3);

    // A 4th manual attempt is not triggered by processDueJobs — the job is no longer PENDING.
    await svc.processDueJobs();
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('marks the job failed immediately when no handler is registered for its type', async () => {
    const store = new FakeRetryJobsStore();
    const svc = buildService(store);

    const job = await svc.enqueue(RetryJobType.AGREEMENT_CREATION, {}, 'no-handler-1');
    const result = await svc.processJob(job);

    expect(result.status).toBe(RetryJobStatus.FAILED);
    expect(result.last_error).toContain('No handler registered');
  });
});

// ---------------------------------------------------------------------------
// manualRetry — admin-triggered re-run
// ---------------------------------------------------------------------------
describe('RetryQueueService.manualRetry', () => {
  it('re-runs a failed job and the manual retry executes the handler exactly once', async () => {
    const store = new FakeRetryJobsStore();
    const svc = buildService(store);

    const handler = jest.fn().mockRejectedValueOnce(new Error('still down'));
    svc.registerHandler(RetryJobType.MILESTONE_UPDATE, handler);

    let job = await svc.enqueue(RetryJobType.MILESTONE_UPDATE, {}, 'milestone-1', {
      maxAttempts: 1,
    });
    job = await svc.processJob(job);
    expect(job.status).toBe(RetryJobStatus.FAILED);
    expect(handler).toHaveBeenCalledTimes(1);

    handler.mockResolvedValueOnce(undefined);
    const retried = await svc.manualRetry(job.id);

    expect(retried.status).toBe(RetryJobStatus.SUCCEEDED);
    // Exactly one additional invocation — the manual retry itself ran the handler once.
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('throws NotFoundException for an unknown job id', async () => {
    const store = new FakeRetryJobsStore();
    const svc = buildService(store);
    await expect(svc.manualRetry('missing-id')).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when retrying an already-succeeded job', async () => {
    const store = new FakeRetryJobsStore();
    const svc = buildService(store);
    svc.registerHandler(RetryJobType.STATUS_SYNC, jest.fn().mockResolvedValue(undefined));

    const job = await svc.enqueue(RetryJobType.STATUS_SYNC, {}, 'succeeded-1');
    await svc.processJob(job);

    await expect(svc.manualRetry(job.id)).rejects.toThrow(ConflictException);
  });
});

// ---------------------------------------------------------------------------
// Restart / persistence — a job started before a "restart" resumes afterward
// ---------------------------------------------------------------------------
describe('RetryQueueService — restart/persistence', () => {
  it('resumes a job left PENDING (scheduled backoff) after a simulated process restart', async () => {
    const store = new FakeRetryJobsStore();

    // "Process A": enqueue and fail once, leaving the job PENDING with a future next_attempt_at.
    const svcA = buildService(store);
    svcA.registerHandler(
      RetryJobType.PAYMENT_EXECUTION,
      jest.fn().mockRejectedValue(new Error('down')),
    );
    const job = await svcA.enqueue(RetryJobType.PAYMENT_EXECUTION, { amount: 5 }, 'restart-1');
    await svcA.processJob(job);

    // Move the due time into the past, as if enough wall-clock time passed while the process was down.
    store.update(job.id, { next_attempt_at: new Date(Date.now() - 1000).toISOString() });

    // "Process B": a fresh RetryQueueService instance over the SAME persisted store — this is the
    // restart. It re-registers handlers (as a real bootstrap would) and polls for due work.
    const svcB = buildService(store);
    const resumedHandler = jest.fn().mockResolvedValue(undefined);
    svcB.registerHandler(RetryJobType.PAYMENT_EXECUTION, resumedHandler);

    await svcB.processDueJobs();

    const finalJob = await svcB.getJob(job.id);
    expect(finalJob?.status).toBe(RetryJobStatus.SUCCEEDED);
    expect(resumedHandler).toHaveBeenCalledTimes(1);
  });

  it('reclaims a job orphaned mid-PROCESSING by a crash and resumes it', async () => {
    const store = new FakeRetryJobsStore();

    // Simulate a crash: a job stuck in PROCESSING with a stale updated_at, never reaching succeeded/failed.
    const staleUpdatedAt = new Date(Date.now() - 120_000).toISOString();
    store.insert({
      job_type: RetryJobType.CONTRACT_RETRIEVAL,
      idempotency_key: 'crashed-1',
      payload: {},
      status: RetryJobStatus.PROCESSING,
      attempts: 1,
      max_attempts: 5,
      next_attempt_at: new Date(Date.now() - 5000).toISOString(),
      updated_at: staleUpdatedAt,
    });
    const jobId = [...store.rows.values()][0].id;

    const svcB = buildService(store, { RETRY_QUEUE_STALE_PROCESSING_MS: '60000' });
    const handler = jest.fn().mockResolvedValue(undefined);
    svcB.registerHandler(RetryJobType.CONTRACT_RETRIEVAL, handler);

    await svcB.processDueJobs();

    const finalJob = await svcB.getJob(jobId);
    expect(finalJob?.status).toBe(RetryJobStatus.SUCCEEDED);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
