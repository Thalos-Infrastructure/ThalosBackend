import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OpportunitiesService } from './opportunities.service';
import type { Opportunity } from './opportunity.types';
import type { CreateOpportunityDto } from './dto/opportunities.dto';

const OWNER_USER = 'user-owner';
const OTHER_USER = 'user-other';
const PERSONAL_USER = 'user-personal';
const OWNER_WALLET = 'G_OWNER';
const OTHER_WALLET = 'G_OTHER';
const PERSONAL_WALLET = 'G_PERSONAL';
const OWNER_PROFILE = 'profile-owner';
const OTHER_PROFILE = 'profile-other';
const PERSONAL_PROFILE = 'profile-personal';

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: overrides.id ?? 'opp-1',
    project_id: overrides.project_id ?? OWNER_PROFILE,
    title: overrides.title ?? 'Soroban reviewer',
    description: overrides.description ?? 'Review a single-release escrow contract.',
    skills_required: overrides.skills_required ?? ['rust', 'soroban'],
    budget_amount: overrides.budget_amount ?? 1500,
    budget_asset: overrides.budget_asset ?? 'USDC',
    engagement_type: overrides.engagement_type ?? 'fixed',
    status: overrides.status ?? 'open',
    created_at: overrides.created_at ?? '2026-08-01T00:00:00Z',
  };
}

const createDto: CreateOpportunityDto = {
  title: 'Soroban reviewer',
  description: 'Review a single-release escrow contract.',
  skills_required: ['rust', 'soroban'],
  budget_amount: 1500,
  engagement_type: 'fixed',
};

interface ProfileRow {
  id: string;
  wallet: string;
  account_type: 'personal' | 'enterprise';
}

interface Store {
  users: Record<string, string>;
  profiles: Record<string, ProfileRow>;
  opportunities: Opportunity[];
}

interface FilterState {
  table: string;
  eq: Record<string, unknown>;
  gte: Record<string, number>;
  lte: Record<string, number>;
  overlaps: Record<string, string[]>;
  or?: string;
  insertRow?: Record<string, unknown>;
  updateRow?: Record<string, unknown>;
  deleted?: boolean;
  range?: { from: number; to: number };
  orderDesc?: boolean;
}

function matchesIlike(orExpr: string, row: Opportunity): boolean {
  const match = /title\.ilike\.%(.+)%,description\.ilike\.%(.+)%/.exec(orExpr);
  if (!match) return true;
  const needle = match[1].toLowerCase();
  return row.title.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle);
}

function makeClient(store: Store) {
  return {
    from(table: string) {
      const state: FilterState = {
        table,
        eq: {},
        gte: {},
        lte: {},
        overlaps: {},
      };

      const builder: Record<string, unknown> = {};
      const applySelect = () => {
        if (table === 'auth_users') {
          const id = state.eq.id as string | undefined;
          const wallet = id ? store.users[id] : undefined;
          return {
            data: wallet ? { wallet_public_key: wallet } : null,
            error: null,
            count: null,
          };
        }
        if (table === 'profiles') {
          const wallet = state.eq.wallet_address as string | undefined;
          const profile = wallet
            ? Object.values(store.profiles).find((p) => p.wallet === wallet)
            : undefined;
          return {
            data: profile ? { id: profile.id, account_type: profile.account_type } : null,
            error: null,
            count: null,
          };
        }

        let rows = [...store.opportunities];
        for (const [col, val] of Object.entries(state.eq)) {
          rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[col] === val);
        }
        for (const [col, val] of Object.entries(state.gte)) {
          rows = rows.filter((r) => Number((r as unknown as Record<string, unknown>)[col]) >= val);
        }
        for (const [col, val] of Object.entries(state.lte)) {
          rows = rows.filter((r) => Number((r as unknown as Record<string, unknown>)[col]) <= val);
        }
        for (const [col, wanted] of Object.entries(state.overlaps)) {
          rows = rows.filter((r) => {
            const have = (r as unknown as Record<string, unknown>)[col];
            return Array.isArray(have) && wanted.some((s) => have.includes(s));
          });
        }
        if (state.or) {
          rows = rows.filter((r) => matchesIlike(state.or as string, r));
        }
        if (state.orderDesc) {
          rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        }
        const total = rows.length;
        if (state.range) {
          rows = rows.slice(state.range.from, state.range.to + 1);
        }
        return { data: rows, error: null, count: total };
      };

      Object.assign(builder, {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          state.eq[col] = val;
          return builder;
        },
        gte: (col: string, val: number) => {
          state.gte[col] = val;
          return builder;
        },
        lte: (col: string, val: number) => {
          state.lte[col] = val;
          return builder;
        },
        overlaps: (col: string, val: string[]) => {
          state.overlaps[col] = val;
          return builder;
        },
        or: (expr: string) => {
          state.or = expr;
          return builder;
        },
        order: () => {
          state.orderDesc = true;
          return builder;
        },
        range: (from: number, to: number) => {
          state.range = { from, to };
          return builder;
        },
        insert: (row: Record<string, unknown>) => {
          state.insertRow = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          state.updateRow = row;
          return builder;
        },
        delete: () => {
          state.deleted = true;
          return builder;
        },
        maybeSingle: () => {
          const result = applySelect();
          const row = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return Promise.resolve({ data: row, error: null });
        },
        single: () => {
          if (state.insertRow) {
            const created = opportunity({
              id: `opp-${store.opportunities.length + 1}`,
              ...(state.insertRow as Partial<Opportunity>),
            });
            store.opportunities.push(created);
            return Promise.resolve({ data: created, error: null });
          }
          if (state.updateRow) {
            const id = state.eq.id as string;
            const idx = store.opportunities.findIndex((o) => o.id === id);
            if (idx === -1) return Promise.resolve({ data: null, error: { message: 'missing' } });
            store.opportunities[idx] = { ...store.opportunities[idx], ...state.updateRow };
            return Promise.resolve({ data: store.opportunities[idx], error: null });
          }
          const result = applySelect();
          const row = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return Promise.resolve({ data: row, error: null });
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (state.deleted) {
            const id = state.eq.id as string;
            store.opportunities = store.opportunities.filter((o) => o.id !== id);
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return Promise.resolve(applySelect()).then(resolve);
        },
      });
      return builder;
    },
  };
}

function buildService(opportunities: Opportunity[] = []) {
  const store: Store = {
    users: {
      [OWNER_USER]: OWNER_WALLET,
      [OTHER_USER]: OTHER_WALLET,
      [PERSONAL_USER]: PERSONAL_WALLET,
    },
    profiles: {
      [OWNER_PROFILE]: {
        id: OWNER_PROFILE,
        wallet: OWNER_WALLET,
        account_type: 'enterprise',
      },
      [OTHER_PROFILE]: {
        id: OTHER_PROFILE,
        wallet: OTHER_WALLET,
        account_type: 'enterprise',
      },
      [PERSONAL_PROFILE]: {
        id: PERSONAL_PROFILE,
        wallet: PERSONAL_WALLET,
        account_type: 'personal',
      },
    },
    opportunities: [...opportunities],
  };
  const svc = new OpportunitiesService({
    getClient: () => makeClient(store),
  } as never);
  return { svc, store };
}

describe('OpportunitiesService.create', () => {
  it('creates an open opportunity owned by the caller profile', async () => {
    const { svc } = buildService();
    const { opportunity: created, error } = await svc.create(OWNER_USER, createDto);
    expect(error).toBeNull();
    expect(created.project_id).toBe(OWNER_PROFILE);
    expect(created.status).toBe('open');
    expect(created.budget_asset).toBe('USDC');
  });

  it('rejects project_id that is not the caller', async () => {
    const { svc } = buildService();
    await expect(
      svc.create(OWNER_USER, { ...createDto, project_id: OTHER_PROFILE }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('OpportunitiesService.getById', () => {
  it('returns an open opportunity to any authenticated user', async () => {
    const open = opportunity({ id: 'opp-open' });
    const { svc } = buildService([open]);
    const { opportunity: found } = await svc.getById(OTHER_USER, 'opp-open');
    expect(found.id).toBe('opp-open');
  });

  it('returns 404 for closed opportunities to non-owners', async () => {
    const closed = opportunity({ id: 'opp-closed', status: 'closed' });
    const { svc } = buildService([closed]);
    await expect(svc.getById(OTHER_USER, 'opp-closed')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the owner read a filled opportunity', async () => {
    const filled = opportunity({ id: 'opp-filled', status: 'filled' });
    const { svc } = buildService([filled]);
    const { opportunity: found } = await svc.getById(OWNER_USER, 'opp-filled');
    expect(found.status).toBe('filled');
  });
});

describe('OpportunitiesService.update', () => {
  it('allows the owner to edit fields while open', async () => {
    const { svc } = buildService([opportunity({ id: 'opp-1' })]);
    const { opportunity: updated } = await svc.update(OWNER_USER, 'opp-1', {
      title: 'Updated role title',
    });
    expect(updated.title).toBe('Updated role title');
  });

  it('forbids non-owners from editing', async () => {
    const { svc } = buildService([opportunity({ id: 'opp-1' })]);
    await expect(
      svc.update(OTHER_USER, 'opp-1', { title: 'Hijack title here' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('transitions open → closed and open → filled', async () => {
    const { svc, store } = buildService([
      opportunity({ id: 'a', status: 'open' }),
      opportunity({ id: 'b', status: 'open', created_at: '2026-08-02T00:00:00Z' }),
    ]);
    const closed = await svc.update(OWNER_USER, 'a', { status: 'closed' });
    expect(closed.opportunity.status).toBe('closed');
    const filled = await svc.update(OWNER_USER, 'b', { status: 'filled' });
    expect(filled.opportunity.status).toBe('filled');
    expect(store.opportunities.map((o) => o.status)).toEqual(['closed', 'filled']);
  });

  it('rejects illegal transitions and edits after close', async () => {
    const { svc } = buildService([opportunity({ id: 'opp-1', status: 'closed' })]);
    await expect(svc.update(OWNER_USER, 'opp-1', { status: 'open' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      svc.update(OWNER_USER, 'opp-1', { title: 'Too late to edit this' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OpportunitiesService.discover', () => {
  const seed: Opportunity[] = [
    opportunity({
      id: 'open-rust',
      title: 'Rust bounty hunter',
      description: 'Write Soroban tests for escrow.',
      skills_required: ['rust', 'soroban'],
      budget_amount: 2000,
      engagement_type: 'fixed',
      created_at: '2026-08-03T00:00:00Z',
    }),
    opportunity({
      id: 'open-hourly',
      title: 'Frontend helper',
      description: 'Next.js Connect directory work.',
      skills_required: ['typescript'],
      budget_amount: 400,
      engagement_type: 'hourly',
      created_at: '2026-08-02T00:00:00Z',
    }),
    opportunity({
      id: 'closed-one',
      title: 'Closed rust role',
      description: 'Should never appear in discovery.',
      skills_required: ['rust'],
      budget_amount: 900,
      status: 'closed',
      created_at: '2026-08-04T00:00:00Z',
    }),
    opportunity({
      id: 'filled-one',
      title: 'Filled rust role',
      description: 'Already hired.',
      skills_required: ['rust'],
      budget_amount: 800,
      status: 'filled',
      created_at: '2026-08-05T00:00:00Z',
    }),
  ];

  it('returns only open opportunities', async () => {
    const { svc } = buildService(seed);
    const result = await svc.discover({ page: 1, limit: 20 });
    expect(result.opportunities.map((o) => o.id).sort()).toEqual(['open-hourly', 'open-rust']);
    expect(result.total).toBe(2);
    expect(result.error).toBeNull();
  });

  it('filters by skills overlap, engagement_type, budget range, and text search', async () => {
    const { svc } = buildService(seed);
    const bySkill = await svc.discover({ skills_required: ['rust'], page: 1, limit: 20 });
    expect(bySkill.opportunities.map((o) => o.id)).toEqual(['open-rust']);

    const byType = await svc.discover({ engagement_type: 'hourly', page: 1, limit: 20 });
    expect(byType.opportunities.map((o) => o.id)).toEqual(['open-hourly']);

    const byBudget = await svc.discover({ budget_min: 1000, budget_max: 3000, page: 1, limit: 20 });
    expect(byBudget.opportunities.map((o) => o.id)).toEqual(['open-rust']);

    const byText = await svc.discover({ q: 'directory', page: 1, limit: 20 });
    expect(byText.opportunities.map((o) => o.id)).toEqual(['open-hourly']);
  });

  it('paginates', async () => {
    const { svc } = buildService(seed);
    const page1 = await svc.discover({ page: 1, limit: 1 });
    const page2 = await svc.discover({ page: 2, limit: 1 });
    expect(page1.opportunities).toHaveLength(1);
    expect(page2.opportunities).toHaveLength(1);
    expect(page1.opportunities[0].id).not.toBe(page2.opportunities[0].id);
    expect(page1.total).toBe(2);
  });

  it('rejects inverted budget range', async () => {
    const { svc } = buildService(seed);
    await expect(
      svc.discover({ budget_min: 5000, budget_max: 10, page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OpportunitiesService.remove', () => {
  it('lets the owner delete', async () => {
    const { svc, store } = buildService([opportunity({ id: 'opp-1' })]);
    const result = await svc.remove(OWNER_USER, 'opp-1');
    expect(result.success).toBe(true);
    expect(store.opportunities).toHaveLength(0);
  });

  it('forbids non-owners from deleting', async () => {
    const { svc, store } = buildService([opportunity({ id: 'opp-1' })]);
    await expect(svc.remove(OTHER_USER, 'opp-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(store.opportunities).toHaveLength(1);
  });
});

describe('isAllowedStatusTransition (via service)', () => {
  it('does not allow filled → closed', async () => {
    const { svc } = buildService([opportunity({ id: 'opp-1', status: 'filled' })]);
    await expect(svc.update(OWNER_USER, 'opp-1', { status: 'closed' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('OpportunitiesService enterprise gate', () => {
  it('rejects create from a personal profile with 403', async () => {
    const { svc } = buildService();
    await expect(svc.create(PERSONAL_USER, createDto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects update from a personal profile with 403', async () => {
    const { svc } = buildService([opportunity({ id: 'opp-1', project_id: PERSONAL_PROFILE })]);
    await expect(
      svc.update(PERSONAL_USER, 'opp-1', { title: 'Hijack title here' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects delete from a personal profile with 403', async () => {
    const { svc } = buildService([opportunity({ id: 'opp-1', project_id: PERSONAL_PROFILE })]);
    await expect(svc.remove(PERSONAL_USER, 'opp-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects listMine from a personal profile with 403', async () => {
    const { svc } = buildService();
    await expect(svc.listMine(PERSONAL_USER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a personal profile discover and read open detail', async () => {
    const open = opportunity({ id: 'opp-open' });
    const { svc } = buildService([open]);
    const discovered = await svc.discover({ page: 1, limit: 20 });
    expect(discovered.opportunities.map((o) => o.id)).toEqual(['opp-open']);
    const { opportunity: found } = await svc.getById(PERSONAL_USER, 'opp-open');
    expect(found.id).toBe('opp-open');
  });

  it('returns 404 not 403 when a personal profile reads a closed opportunity', async () => {
    const closed = opportunity({ id: 'opp-closed', status: 'closed' });
    const { svc } = buildService([closed]);
    await expect(svc.getById(PERSONAL_USER, 'opp-closed')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OpportunitiesService.listMine', () => {
  it('returns all statuses for the owning Project', async () => {
    const { svc } = buildService([
      opportunity({ id: 'a', status: 'open' }),
      opportunity({ id: 'b', status: 'filled', created_at: '2026-08-02T00:00:00Z' }),
    ]);
    const result = await svc.listMine(OWNER_USER);
    expect(result.opportunities.map((o) => o.id).sort()).toEqual(['a', 'b']);
    expect(result.error).toBeNull();
  });
});
