import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOpportunityDto, DiscoverOpportunitiesQueryDto } from './opportunities.dto';

describe('CreateOpportunityDto', () => {
  const valid = {
    title: 'Soroban reviewer',
    description: 'Review a single-release escrow contract.',
    skills_required: ['rust'],
    budget_amount: 100,
    engagement_type: 'fixed',
  };

  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateOpportunityDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects non-positive budget_amount', async () => {
    const dto = plainToInstance(CreateOpportunityDto, { ...valid, budget_amount: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'budget_amount')).toBe(true);
  });

  it('rejects empty skill strings', async () => {
    const dto = plainToInstance(CreateOpportunityDto, { ...valid, skills_required: [''] });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'skills_required')).toBe(true);
  });

  it('rejects unknown engagement_type', async () => {
    const dto = plainToInstance(CreateOpportunityDto, { ...valid, engagement_type: 'retainer' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'engagement_type')).toBe(true);
  });
});

describe('DiscoverOpportunitiesQueryDto', () => {
  it('splits comma-separated skills_required', async () => {
    const dto = plainToInstance(DiscoverOpportunitiesQueryDto, {
      skills_required: 'rust, soroban',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.skills_required).toEqual(['rust', 'soroban']);
  });
});
