import { isAllowedStatusTransition } from './opportunity.types';

describe('isAllowedStatusTransition', () => {
  it('allows open → closed and open → filled', () => {
    expect(isAllowedStatusTransition('open', 'closed')).toBe(true);
    expect(isAllowedStatusTransition('open', 'filled')).toBe(true);
  });

  it('rejects every other pair', () => {
    expect(isAllowedStatusTransition('open', 'open')).toBe(false);
    expect(isAllowedStatusTransition('closed', 'open')).toBe(false);
    expect(isAllowedStatusTransition('closed', 'filled')).toBe(false);
    expect(isAllowedStatusTransition('filled', 'closed')).toBe(false);
    expect(isAllowedStatusTransition('filled', 'open')).toBe(false);
  });
});
