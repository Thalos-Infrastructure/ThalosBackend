/**
 * Regression: issue #52 / PR #54
 * Bug: escrow.released webhook mapped incorrectly so the agreement stayed funded
 * instead of completing after release.
 */
import { WebhooksService } from './webhooks.service';
import { RetryJobType } from '../retry-queue/retry-queue.types';

const SECRET = 'test-webhook-secret-32chars-long!!';

type MockedWebhooksService = WebhooksService & {
  _emit: jest.Mock;
  _enqueue: jest.Mock;
  _registerHandler: jest.Mock;
};

function buildService(getClientCalls: unknown[] = []): MockedWebhooksService {
  let callIndex = 0;
  const getClient = jest.fn().mockImplementation(() => getClientCalls[callIndex++]);
  const emit = jest.fn();
  const registerHandler = jest.fn();
  let jobSeq = 0;
  const enqueue = jest.fn().mockImplementation((jobType: string, payload: unknown) => ({
    id: `job-${++jobSeq}`,
    job_type: jobType,
    payload,
  }));

  const svc = new (WebhooksService as unknown as new (...args: unknown[]) => WebhooksService)(
    { getClient },
    { emit },
    { notifyDisputeOpened: jest.fn() },
    {
      get: (key: string, def?: string) =>
        key === 'TRUSTLESS_WORK_WEBHOOK_SECRET' ? SECRET : def,
    },
    { enqueue, registerHandler },
    { logActivity: jest.fn().mockResolvedValue(undefined) },
  ) as MockedWebhooksService;

  svc._emit = emit;
  svc._enqueue = enqueue;
  svc._registerHandler = registerHandler;
  svc.onModuleInit();
  return svc;
}

function selectClient(returnData: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['from', 'select', 'eq'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain['maybeSingle'] = jest.fn().mockResolvedValue({ data: returnData, error: null });
  return chain;
}

function updateClient(returnData: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['from', 'update', 'eq', 'neq', 'select'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain['maybeSingle'] = jest.fn().mockResolvedValue({ data: returnData, error: null });
  return chain;
}

async function runHandleEventAndProcess(
  svc: MockedWebhooksService,
  payload: Record<string, unknown>,
): Promise<void> {
  const result = await svc.handleEvent(payload as never);
  expect(result).toEqual({ handled: true });
  const [, jobPayload] = svc._enqueue.mock.calls[svc._enqueue.mock.calls.length - 1];
  const [, handler] = svc._registerHandler.mock.calls[0];
  await handler(jobPayload, 1);
}

describe('regression: webhook status mapping (issue #52 / PR #54)', () => {
  const row = { id: 'agr-1', title: 'Test', amount: '100', asset: 'USDC' };

  it('maps escrow.released → completed (not funded) and emits agreement.completed', async () => {
    const update = updateClient(row);
    const svc = buildService([selectClient({ status: 'in_review', id: 'agr-1' }), update]);

    await runHandleEventAndProcess(svc, {
      event: 'escrow.released',
      contractId: 'c-released-1',
    });

    // Guard the TW_EVENT_MAP contract itself (re-introducing funded here must fail).
    expect(svc._enqueue).toHaveBeenCalledWith(
      RetryJobType.WEBHOOK_EVENT_PROCESSING,
      expect.objectContaining({
        config: { action: 'status_update', targetStatus: 'completed' },
      }),
      expect.any(String),
    );

    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        completed_at: expect.any(String),
      }),
    );
    expect(update.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'funded' }),
    );

    expect(svc._emit).toHaveBeenCalledWith(
      'agreement.completed',
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
    expect(svc._emit).not.toHaveBeenCalledWith('agreement.funded', expect.anything());
  });
});
