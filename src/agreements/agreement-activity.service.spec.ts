import { AgreementActivityService } from './agreement-activity.service';

describe('AgreementActivityService', () => {
  it('inserts activity rows via supabase including optional state columns', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ insert });
    const supabase = { getClient: () => ({ from }) } as never;

    const svc = new AgreementActivityService(supabase);
    await svc.logActivity(
      'agr-1',
      'GWALLET',
      'dispute_opened',
      { dispute_id: 'd1' },
      { previousState: 'active', newState: 'disputed' },
    );

    expect(from).toHaveBeenCalledWith('agreement_activity');
    expect(insert).toHaveBeenCalledWith({
      agreement_id: 'agr-1',
      actor_wallet: 'GWALLET',
      action: 'dispute_opened',
      details: { dispute_id: 'd1' },
      previous_state: 'active',
      new_state: 'disputed',
    });
  });

  it('defaults previous_state/new_state to null when omitted', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ insert });
    const supabase = { getClient: () => ({ from }) } as never;

    const svc = new AgreementActivityService(supabase);
    await svc.logActivity('agr-1', 'G', 'created');

    expect(insert).toHaveBeenCalledWith({
      agreement_id: 'agr-1',
      actor_wallet: 'G',
      action: 'created',
      details: {},
      previous_state: null,
      new_state: null,
    });
  });

  it('swallows insert errors without throwing', async () => {
    const insert = jest.fn().mockResolvedValue({ error: { message: 'boom' } });
    const from = jest.fn().mockReturnValue({ insert });
    const supabase = { getClient: () => ({ from }) } as never;

    const svc = new AgreementActivityService(supabase);
    await expect(svc.logActivity('agr-1', 'G', 'created')).resolves.toBeUndefined();
  });
});
