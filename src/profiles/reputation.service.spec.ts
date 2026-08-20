import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReputationService } from './reputation.service';

// ---------------------------------------------------------------------------
// Chainable Supabase mock (same pattern used across the project)
// ---------------------------------------------------------------------------
function chainMock(data: unknown, error: unknown = null) {
  const obj: Record<string, jest.Mock> = {};
  ['from', 'select', 'eq', 'in', 'insert', 'update', 'neq', 'maybeSingle', 'single'].forEach(
    (m) => {
      obj[m] = jest.fn().mockReturnValue(obj);
    },
  );
  obj.maybeSingle = jest.fn().mockResolvedValue({ data, error });
  obj.single = jest.fn().mockResolvedValue({ data, error });
  return obj;
}

function buildService(calls: unknown[]) {
  let callIndex = 0;
  const getClient = jest.fn().mockImplementation(() => calls[callIndex++]);
  const supabase = { getClient };
  const svc = new (ReputationService as unknown as new (...args: unknown[]) => ReputationService)(
    supabase,
  );
  return { svc, getClient };
}

// ---------------------------------------------------------------------------
// getPublicReputation
// ---------------------------------------------------------------------------
describe('ReputationService.getPublicReputation', () => {
  it('returns zeroed counts when builder has no agreements', async () => {
    const { svc } = buildService([
      chainMock({ id: 'p1', wallet_address: 'GWALLET', handle: 'alice', show_earnings: false, github_verified: null }),
      chainMock([]), // agreement_participants: empty
    ]);

    const result = await svc.getPublicReputation('alice');

    expect(result).toEqual({
      handle: 'alice',
      completed_agreements_count: 0,
      released_milestones_count: 0,
      total_released_usdc: null, // opted out
      github_verified: null,
      pr_backed_milestone_count: 0,
    });
  });

  it('counts completed agreements and released milestones correctly', async () => {
    const { svc } = buildService([
      chainMock({ id: 'p1', wallet_address: 'GWALLET', handle: 'bob', show_earnings: false, github_verified: null }),
      chainMock([{ agreement_id: 'a1' }, { agreement_id: 'a2' }]),
      chainMock([
        {
          id: 'a1',
          status: 'completed',
          milestones: [
            { status: 'released', amount: '100', evidence_urls: [] },
            { status: 'approved', amount: '50', evidence_urls: [] },
          ],
        },
        {
          id: 'a2',
          status: 'active',
          milestones: [
            { status: 'released', amount: '200', evidence_urls: ['https://github.com/org/repo/pull/1'] },
          ],
        },
      ]),
    ]);

    const result = await svc.getPublicReputation('bob');

    expect(result.completed_agreements_count).toBe(1);
    expect(result.released_milestones_count).toBe(2);
    expect(result.total_released_usdc).toBeNull(); // opted out
    expect(result.pr_backed_milestone_count).toBe(1);
  });

  it('includes total_released_usdc when builder has opted in', async () => {
    const { svc } = buildService([
      chainMock({ id: 'p1', wallet_address: 'GWALLET', handle: 'carol', show_earnings: true, github_verified: true }),
      chainMock([{ agreement_id: 'a1' }]),
      chainMock([
        {
          id: 'a1',
          status: 'completed',
          milestones: [
            { status: 'released', amount: '150.50', evidence_urls: [] },
            { status: 'released', amount: '250.25', evidence_urls: [] },
          ],
        },
      ]),
    ]);

    const result = await svc.getPublicReputation('carol');

    expect(result.total_released_usdc).toBe(400.75);
    expect(result.github_verified).toBe(true);
  });

  it('returns github_verified as null when C6 data is not yet available', async () => {
    const { svc } = buildService([
      chainMock({ id: 'p1', wallet_address: 'GWALLET', handle: 'dave', show_earnings: false, github_verified: null }),
      chainMock([]),
    ]);

    const result = await svc.getPublicReputation('dave');
    expect(result.github_verified).toBeNull();
  });

  it('throws NotFoundException for unknown handle', async () => {
    const { svc } = buildService([chainMock(null)]);

    await expect(svc.getPublicReputation('ghost')).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException on DB error', async () => {
    const { svc } = buildService([chainMock(null, { message: 'DB down' })]);

    await expect(svc.getPublicReputation('alice')).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// getMyReputation
// ---------------------------------------------------------------------------
describe('ReputationService.getMyReputation', () => {
  it('returns the authenticated builder reputation with earnings included', async () => {
    const { svc } = buildService([
      // profileByUserId: auth_users lookup
      chainMock({ wallet_public_key: 'GWALLET' }),
      // profileByUserId: profiles lookup
      chainMock({ id: 'p1', wallet_address: 'GWALLET', handle: 'alice', show_earnings: false, github_verified: null }),
      // fetchBuilderAgreements: participants
      chainMock([{ agreement_id: 'a1' }]),
      // fetchBuilderAgreements: agreements
      chainMock([
        {
          id: 'a1',
          status: 'completed',
          milestones: [
            { status: 'released', amount: '300', evidence_urls: ['https://github.com/pr/1'] },
          ],
        },
      ]),
    ]);

    const result = await svc.getMyReputation('user-id-1');

    expect(result.handle).toBe('alice');
    expect(result.completed_agreements_count).toBe(1);
    expect(result.released_milestones_count).toBe(1);
    expect(result.total_released_usdc).toBe(300); // always included for /me
    expect(result.pr_backed_milestone_count).toBe(1);
  });

  it('always includes earnings for /me even when show_earnings is false', async () => {
    const { svc } = buildService([
      chainMock({ wallet_public_key: 'GWALLET' }),
      chainMock({ id: 'p1', wallet_address: 'GWALLET', handle: 'bob', show_earnings: false, github_verified: null }),
      chainMock([{ agreement_id: 'a1' }]),
      chainMock([
        {
          id: 'a1',
          status: 'completed',
          milestones: [{ status: 'released', amount: '500', evidence_urls: [] }],
        },
      ]),
    ]);

    const result = await svc.getMyReputation('user-id-1');
    expect(result.total_released_usdc).toBe(500);
  });

  it('throws NotFoundException when user has no wallet', async () => {
    const { svc } = buildService([chainMock(null)]);

    await expect(svc.getMyReputation('no-wallet-user')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when user has no profile', async () => {
    const { svc } = buildService([
      chainMock({ wallet_public_key: 'GWALLET' }),
      chainMock(null),
    ]);

    await expect(svc.getMyReputation('user-no-profile')).rejects.toThrow(NotFoundException);
  });

  it('counts PR-backed milestones (evidence_urls present)', async () => {
    const { svc } = buildService([
      chainMock({ wallet_public_key: 'GWALLET' }),
      chainMock({ id: 'p1', wallet_address: 'GWALLET', handle: 'eve', show_earnings: false, github_verified: null }),
      chainMock([{ agreement_id: 'a1' }]),
      chainMock([
        {
          id: 'a1',
          status: 'active',
          milestones: [
            { status: 'approved', amount: '100', evidence_urls: ['https://github.com/org/repo/pull/42'] },
            { status: 'released', amount: '100', evidence_urls: [] },
            { status: 'pending', amount: '100', evidence_urls: ['https://github.com/org/repo/pull/43'] },
          ],
        },
      ]),
    ]);

    const result = await svc.getMyReputation('user-eve');
    expect(result.pr_backed_milestone_count).toBe(2);
    expect(result.released_milestones_count).toBe(1);
  });

  it('handles agreements with null milestones gracefully', async () => {
    const { svc } = buildService([
      chainMock({ wallet_public_key: 'GWALLET' }),
      chainMock({ id: 'p1', wallet_address: 'GWALLET', handle: 'frank', show_earnings: false, github_verified: null }),
      chainMock([{ agreement_id: 'a1' }]),
      chainMock([
        {
          id: 'a1',
          status: 'completed',
          milestones: null,
        },
      ]),
    ]);

    const result = await svc.getMyReputation('user-frank');
    expect(result.completed_agreements_count).toBe(1);
    expect(result.released_milestones_count).toBe(0);
    expect(result.pr_backed_milestone_count).toBe(0);
  });

  it('handles non-numeric milestone amounts gracefully', async () => {
    const { svc } = buildService([
      chainMock({ wallet_public_key: 'GWALLET' }),
      chainMock({ id: 'p1', wallet_address: 'GWALLET', handle: 'grace', show_earnings: true, github_verified: null }),
      chainMock([{ agreement_id: 'a1' }]),
      chainMock([
        {
          id: 'a1',
          status: 'completed',
          milestones: [
            { status: 'released', amount: 'not-a-number', evidence_urls: [] },
            { status: 'released', amount: '100', evidence_urls: [] },
          ],
        },
      ]),
    ]);

    const result = await svc.getMyReputation('user-grace');
    expect(result.total_released_usdc).toBe(100);
  });
});
