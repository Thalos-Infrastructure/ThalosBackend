export type SupabaseMockResult<T = unknown> = {
  data: T;
  error: { message: string } | null;
  count?: number | null;
};

export type SupabaseQueryMock<T = unknown> = {
  select: jest.Mock;
  neq: jest.Mock;
  eq: jest.Mock;
  or: jest.Mock;
  range: jest.Mock;
  limit: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  then: Promise<SupabaseMockResult<T>>["then"];
};

export function createSupabaseQueryMock<T>(
  result: SupabaseMockResult<T>,
): SupabaseQueryMock<T> {
  const query = {} as SupabaseQueryMock<T>;
  const chain = () => jest.fn(() => query);

  query.select = chain();
  query.neq = chain();
  query.eq = chain();
  query.or = chain();
  query.range = chain();
  query.limit = chain();
  query.insert = chain();
  query.update = chain();
  query.delete = chain();
  query.single = chain();
  query.maybeSingle = chain();
  const response = Promise.resolve(result);
  query.then = response.then.bind(response);

  return query;
}

export function createSupabaseClientMock<T>(query: SupabaseQueryMock<T>) {
  return {
    from: jest.fn(() => query),
  };
}
