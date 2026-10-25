import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DisputesService } from './disputes.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AgreementsService } from '../agreements/agreements.service';
import { AgreementActivityService } from '../agreements/agreement-activity.service';

const USER = '22222222-2222-2222-2222-222222222222';
const WALLET = 'GPROPOSER';

describe('DisputesService — settlement proposals', () => {
  it('refuses percentages that do not sum to 100', async () => {
    const service = new DisputesService(
      {
        getClient: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { wallet_public_key: WALLET }, error: null }),
              }),
            }),
          }),
        }),
      } as unknown as SupabaseService,
      {} as AgreementsService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      {} as AgreementActivityService,
    );

    await expect(
      service.proposeSettlement(USER, 'd1', {
        proposed_by: WALLET,
        payer_percentage: 60,
        payee_percentage: 30,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
