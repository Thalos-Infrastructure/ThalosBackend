/**
 * Reusable Supabase mock helpers for tests.
 *
 * Usage:
 *   import { createSupabaseMock, SupabaseQueryBuilderMock } from '../test-helpers/supabase-mock';
 *
 *   // Simple: mock a single table query that returns data
 *   const supabase = createSupabaseMock({ data: [{ id: 1, name: 'test' }] });
 *
 *   // Per-table: different responses for different tables
 *   const supabase = createSupabaseMock({
 *     tables: {
 *       profiles: { data: { email: 'test@example.com' }, error: null },
 *       agreements: { data: [{ id: 'a1' }], error: null },
 *     },
 *   });
 *
 *   // In your test:
 *   const service = new SomeService({ getClient: () => supabase } as any, ...config);
 */

/** A chainable mock that mirrors Supabase's `.from().select().eq().maybeSingle()` pattern. */
export class SupabaseQueryBuilderMock {
  private _data: unknown;
  private _error: unknown = null;

  constructor(data: unknown, error: unknown = null) {
    this._data = data;
    this._error = error;
  }

  from(_table: string) {
    return this;
  }

  select(_columns?: string) {
    return this;
  }

  eq(_column: string, _value: unknown) {
    return this;
  }

  neq(_column: string, _value: unknown) {
    return this;
  }

  insert(_data: unknown) {
    return Promise.resolve({ data: null, error: null });
  }

  update(_data: unknown) {
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: this._data, error: this._error });
  }

  single() {
    return Promise.resolve({ data: this._data, error: this._error });
  }

  then(resolve: (value: unknown) => unknown) {
    // Allow use as a thenable (e.g. `await supabase.from('x').select()`)
    return Promise.resolve({ data: this._data, error: this._error }).then(resolve);
  }
}

interface PerTableResponse {
  data: unknown;
  error?: unknown;
}

interface CreateSupabaseMockOptions {
  /** Default data returned for any table query (when `tables` is not specified) */
  data?: unknown;
  /** Default error returned for any table query */
  error?: unknown;
  /** Per-table overrides: key = table name, value = { data, error } */
  tables?: Record<string, PerTableResponse>;
}

/**
 * Create a mock Supabase client suitable for injecting into `SupabaseService`.
 *
 * Returns an object with `.from(table)` that chains `.select().eq().maybeSingle()`.
 * Pass `tables` for per-table responses, or `data`/`error` for a uniform stub.
 *
 * @example
 *   const mock = createSupabaseMock({ data: { email: 'a@b.com' } });
 *   const client = { getClient: () => mock } as unknown as SupabaseService;
 */
export function createSupabaseMock(options: CreateSupabaseMockOptions = {}) {
  const tables = options.tables ?? {};
  const defaultData = options.data ?? null;
  const defaultError = options.error ?? null;

  return {
    from(table: string) {
      const override = tables[table];
      const data = override?.data ?? defaultData;
      const error = override?.error ?? defaultError;
      return new SupabaseQueryBuilderMock(data, error);
    },
  };
}
