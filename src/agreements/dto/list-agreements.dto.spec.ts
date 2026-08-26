import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListAgreementsQueryDto } from './list-agreements.dto';
import { AGREEMENT_STATUSES } from '../agreement-lifecycle';
import { AGREEMENT_TYPES } from '../agreement-types';

const parse = (query: Record<string, unknown>) => plainToInstance(ListAgreementsQueryDto, query);

describe('ListAgreementsQueryDto', () => {
  it('accepts no filters at all', async () => {
    const dto = parse({});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.status).toBeUndefined();
    expect(dto.type).toBeUndefined();
  });

  it.each([...AGREEMENT_STATUSES])('accepts status "%s"', async (status) => {
    const dto = parse({ status });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.status).toBe(status);
  });

  it.each([...AGREEMENT_TYPES])('accepts type "%s"', async (type) => {
    const dto = parse({ type });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.type).toBe(type);
  });

  it('accepts both filters together', async () => {
    const dto = parse({ status: 'active', type: 'multi' });
    expect(await validate(dto)).toHaveLength(0);
  });

  // `?status=&type=` is what a filter UI sends before anything is picked.
  it.each(['', '   '])('treats a blank value (%p) as no filter', async (blank) => {
    const dto = parse({ status: blank, type: blank });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.status).toBeUndefined();
    expect(dto.type).toBeUndefined();
  });

  it('rejects an unknown status', async () => {
    const errors = await validate(parse({ status: 'archived' }));
    expect(errors.map((e) => e.property)).toEqual(['status']);
  });

  it('rejects an unknown type', async () => {
    const errors = await validate(parse({ type: 'retainer' }));
    expect(errors.map((e) => e.property)).toEqual(['type']);
  });
});
