import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import type { Request } from 'express';

const SECRET = 'test-webhook-secret-32chars-long!!';

function hmac(body: string, secret = SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// Helpers to build a WebhooksService with injected mocks (no NestJS DI)
// ---------------------------------------------------------------------------

interface MockDeps {
  getClientCalls?: Array<unknown>;
  emit?: jest.Mock;
  notifyDisputeOpened?: jest.Mock;
  secret?: string;
}

function buildService(
  deps: MockDeps = {},
): WebhooksService & { _emit: jest.Mock; _notifyDispute: jest.Mock } {
  const emit = deps.emit ?? jest.fn();
  const notifyDisputeOpened = deps.notifyDisputeOpened ?? jest.fn().mockResolvedValue(undefined);

  const calls = deps.getClientCalls ?? [];
  let callIndex = 0;
  const getClient = jest.fn().mockImplementation(() => calls[callIndex++]);

  const supabase = { getClient };
  const eventEmitter = { emit };
  const notifications = { notifyDisputeOpened };
  const config = {
    get: (key: string, def?: string) =>
      key === 'TRUSTLESS_WORK_WEBHOOK_SECRET' ? (deps.secret ?? SECRET) : def,
  };

  const svc = new (WebhooksService as unknown as new (...args: unknown[]) => WebhooksService)(
    supabase,
    eventEmitter,
    notifications,
    config,
  ) as WebhooksService & { _emit: jest.Mock; _notifyDispute: jest.Mock };

  svc._emit = emit;
  svc._notifyDispute = notifyDisputeOpened;
  return svc;
}

// Supabase client stub for the atomic UPDATE path
function updateClient(returnData: unknown, returnError: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  ['from', 'update', 'eq', 'neq', 'select'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain['maybeSingle'] = jest.fn().mockResolvedValue({ data: returnData, error: returnError });
  return chain;
}

// Supabase client stub for the fallback SELECT path (idempotency / not-found check)
function selectClient(returnData: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['from', 'select', 'eq'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain['maybeSingle'] = jest.fn().mockResolvedValue({ data: returnData, error: null });
  return chain;
}

// Supabase client stub for selecting agreement milestones
function milestoneSelectClient(agreementData: unknown) {
  const chain: Record<string, jest.Mock> = {};
  ['from', 'select', 'eq'].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain['maybeSingle'] = jest.fn().mockResolvedValue({ data: agreementData, error: null });
  return chain;
}

// Supabase client stub for milestone UPDATE (no select/maybeSingle)
function milestoneUpdateClient(returnError: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  chain['from'] = jest.fn().mockReturnValue(chain);
  chain['update'] = jest.fn().mockReturnValue(chain);
  chain['eq'] = jest.fn().mockResolvedValue({ error: returnError });
  return chain;
}

// Supabase client stub for logActivity INSERT (always succeeds)
function insertClient() {
  return {
    from: jest.fn().mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: null }) }),
  };
}

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------
describe('WebhooksService.verifySignature', () => {
  let svc: WebhooksService;
  beforeEach(() => {
    svc = buildService();
  });

  it('accepts a correct sha256= prefixed signature', () => {
    const body = '{"event":"escrow.funded","contractId":"abc"}';
    expect(svc.verifySignature(Buffer.from(body), hmac(body))).toBe(true);
  });

  it('accepts a signature without sha256= prefix', () => {
    const body = '{"event":"escrow.funded","contractId":"abc"}';
    const hash = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(svc.verifySignature(Buffer.from(body), hash)).toBe(true);
  });

  it('rejects an incorrect signature', () => {
    const body = '{"event":"escrow.funded","contractId":"abc"}';
    const wrong = 'sha256=' + 'a'.repeat(64);
    expect(svc.verifySignature(Buffer.from(body), wrong)).toBe(false);
  });

  it('rejects when TRUSTLESS_WORK_WEBHOOK_SECRET is empty', () => {
    const svc2 = buildService({ secret: '' });
    const body = '{"event":"escrow.funded","contractId":"abc"}';
    expect(svc2.verifySignature(Buffer.from(body), hmac(body))).toBe(false);
  });

  it('rejects a hex string with wrong length (timingSafeEqual guard)', () => {
    const body = '{"event":"escrow.funded","contractId":"abc"}';
    expect(svc.verifySignature(Buffer.from(body), 'sha256=tooshort')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleEvent — status transitions
// ---------------------------------------------------------------------------
describe('WebhooksService.handleEvent — status transitions', () => {
  const row = { id: 'agr-1', title: 'Test', amount: '100', asset: 'USDC' };

  it('escrow.funded → funded: updates DB and emits agreement.funded', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    const result = await svc.handleEvent({ event: 'escrow.funded', contractId: 'c-1' });
    expect(result).toEqual({ handled: true });
    expect(svc._emit).toHaveBeenCalledWith(
      'agreement.funded',
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
  });

  it('escrow.released → completed: updates DB and emits agreement.completed', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    const result = await svc.handleEvent({ event: 'escrow.released', contractId: 'c-2' });
    expect(result).toEqual({ handled: true });
    expect(svc._emit).toHaveBeenCalledWith(
      'agreement.completed',
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
  });

  it('contract.completed → completed: updates DB and emits agreement.completed', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    const result = await svc.handleEvent({ event: 'contract.completed', contractId: 'c-2' });
    expect(result).toEqual({ handled: true });
    expect(svc._emit).toHaveBeenCalledWith(
      'agreement.completed',
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
  });

  it('escrow.disputed → disputed: updates DB and calls notifyDisputeOpened', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    const result = await svc.handleEvent({ event: 'escrow.disputed', contractId: 'c-3' });
    expect(result).toEqual({ handled: true });
    expect(svc._notifyDispute).toHaveBeenCalledWith(
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
  });

  it('dispute.created → disputed: updates DB and calls notifyDisputeOpened', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    const result = await svc.handleEvent({ event: 'dispute.created', contractId: 'c-3' });
    expect(result).toEqual({ handled: true });
    expect(svc._notifyDispute).toHaveBeenCalledWith(
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
  });

  it('escrow.dispute_created → disputed: updates DB and calls notifyDisputeOpened', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    const result = await svc.handleEvent({ event: 'escrow.dispute_created', contractId: 'c-3' });
    expect(result).toEqual({ handled: true });
    expect(svc._notifyDispute).toHaveBeenCalledWith(
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
  });

  it('contract.cancelled → cancelled: updates DB without notification', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    const result = await svc.handleEvent({ event: 'contract.cancelled', contractId: 'c-4' });
    expect(result).toEqual({ handled: true });
    expect(svc._emit).not.toHaveBeenCalled();
    expect(svc._notifyDispute).not.toHaveBeenCalled();
  });

  it('funded path does not emit completed or call notifyDisputeOpened', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    await svc.handleEvent({ event: 'escrow.funded', contractId: 'c-1' });
    expect(svc._emit).not.toHaveBeenCalledWith('agreement.completed', expect.anything());
    expect(svc._notifyDispute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleEvent — milestone updates
// ---------------------------------------------------------------------------
describe('WebhooksService.handleEvent — milestone updates', () => {
  const agreementData = {
    id: 'agr-1',
    milestones: [
      { description: 'First milestone', amount: '50', status: 'pending' },
      { description: 'Second milestone', amount: '50', status: 'pending' },
    ],
  };

  it('escrow.milestone_updated: updates milestone status via payload.milestone', async () => {
    const svc = buildService({
      getClientCalls: [
        milestoneSelectClient(agreementData),
        milestoneUpdateClient(),
        insertClient(),
      ],
    });
    const result = await svc.handleEvent({
      event: 'escrow.milestone_updated',
      contractId: 'c-1',
      milestone: { index: 0, status: 'completed' },
    });
    expect(result).toEqual({ handled: true });
  });

  it('agreement.milestone_updated: updates milestone status', async () => {
    const svc = buildService({
      getClientCalls: [
        milestoneSelectClient(agreementData),
        milestoneUpdateClient(),
        insertClient(),
      ],
    });
    const result = await svc.handleEvent({
      event: 'agreement.milestone_updated',
      contractId: 'c-1',
      milestone: { index: 1, status: 'approved' },
    });
    expect(result).toEqual({ handled: true });
  });

  it('uses data.milestone_index fallback when payload.milestone is absent', async () => {
    const svc = buildService({
      getClientCalls: [
        milestoneSelectClient(agreementData),
        milestoneUpdateClient(),
        insertClient(),
      ],
    });
    const result = await svc.handleEvent({
      event: 'escrow.milestone_updated',
      contractId: 'c-1',
      data: { milestone_index: 0, status: 'completed' },
    });
    expect(result).toEqual({ handled: true });
  });
});

// ---------------------------------------------------------------------------
// handleEvent — info events
// ---------------------------------------------------------------------------
describe('WebhooksService.handleEvent — info events', () => {
  it('agreement.created: logs activity without status change', async () => {
    const svc = buildService({
      getClientCalls: [selectClient({ id: 'agr-1' }), insertClient()],
    });
    const result = await svc.handleEvent({
      event: 'agreement.created',
      contractId: 'c-1',
      data: { title: 'New Agreement' },
    });
    expect(result).toEqual({ handled: true });
    expect(svc._emit).not.toHaveBeenCalled();
    expect(svc._notifyDispute).not.toHaveBeenCalled();
  });

  it('agreement.updated: logs activity without status change', async () => {
    const svc = buildService({
      getClientCalls: [selectClient({ id: 'agr-1' }), insertClient()],
    });
    const result = await svc.handleEvent({
      event: 'agreement.updated',
      contractId: 'c-1',
    });
    expect(result).toEqual({ handled: true });
  });

  it('escrow.created: logs activity without status change', async () => {
    const svc = buildService({
      getClientCalls: [selectClient({ id: 'agr-1' }), insertClient()],
    });
    const result = await svc.handleEvent({ event: 'escrow.created', contractId: 'c-1' });
    expect(result).toEqual({ handled: true });
  });

  it('escrow.updated: logs activity without status change', async () => {
    const svc = buildService({
      getClientCalls: [selectClient({ id: 'agr-1' }), insertClient()],
    });
    const result = await svc.handleEvent({ event: 'escrow.updated', contractId: 'c-1' });
    expect(result).toEqual({ handled: true });
  });

  it('info event for unknown contractId logs warning and still succeeds', async () => {
    const svc = buildService({
      getClientCalls: [selectClient(null)],
    });
    const result = await svc.handleEvent({ event: 'agreement.created', contractId: 'ghost' });
    expect(result).toEqual({ handled: true });
  });
});

// ---------------------------------------------------------------------------
// handleEvent — idempotency (atomic guard)
// ---------------------------------------------------------------------------
describe('WebhooksService.handleEvent — idempotency', () => {
  it('returns handled for duplicate status (already_applied)', async () => {
    const existing = { id: 'agr-2', status: 'funded' };
    const svc = buildService({ getClientCalls: [updateClient(null), selectClient(existing)] });
    const result = await svc.handleEvent({ event: 'escrow.funded', contractId: 'dup' });
    expect(result).toEqual({ handled: true });
  });

  it('does NOT emit any event or call any notification on duplicate', async () => {
    const existing = { id: 'agr-2', status: 'funded' };
    const svc = buildService({ getClientCalls: [updateClient(null), selectClient(existing)] });
    await svc.handleEvent({ event: 'escrow.funded', contractId: 'dup' });
    expect(svc._emit).not.toHaveBeenCalled();
    expect(svc._notifyDispute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleEvent — edge cases (no retries triggered)
// ---------------------------------------------------------------------------
describe('WebhooksService.handleEvent — edge cases', () => {
  it('returns unhandled_event_type for unknown events without touching DB', async () => {
    const svc = buildService();
    const result = await svc.handleEvent({ event: 'escrow.paused', contractId: 'x' });
    expect(result).toEqual({ handled: false, reason: 'unhandled_event_type' });
  });
});

// ---------------------------------------------------------------------------
// handleEvent — retry mechanism
// ---------------------------------------------------------------------------
describe('WebhooksService.handleEvent — retry mechanism', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('succeeds on first retry after a transient DB error', async () => {
    const row = { id: 'agr-1', title: 'Test', amount: '100', asset: 'USDC' };

    // Attempt 0 fails, attempt 1 succeeds
    const failClient = updateClient(null, { message: 'timeout' });
    const successClient = updateClient(row);
    const logClient = insertClient();

    const svc = buildService({
      getClientCalls: [failClient, successClient, logClient],
    });

    const promise = svc.handleEvent({ event: 'escrow.funded', contractId: 'c-1' });

    await jest.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toEqual({ handled: true });
    expect(svc._emit).toHaveBeenCalledWith(
      'agreement.funded',
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
  });

  it('fails after exhausting all retries', async () => {
    const errClient = updateClient(null, { message: 'persistent error' });

    // 4 attempts (0 initial + 3 retries), each needs one client
    const svc = buildService({
      getClientCalls: [errClient, errClient, errClient, errClient],
    });

    const promise = svc.handleEvent({ event: 'escrow.funded', contractId: 'c-1' });

    await jest.advanceTimersByTimeAsync(8000);

    const result = await promise;
    expect(result).toEqual({ handled: false, reason: 'processing_failed' });
  });

  it('returns processing_failed when agreement not found after retries', async () => {
    // Each attempt: update returns null, select returns null → throws Error
    // 4 attempts × 2 clients each = 8 total
    const clients = [];
    for (let i = 0; i < 4; i++) {
      clients.push(updateClient(null));
      clients.push(selectClient(null));
    }

    const svc = buildService({ getClientCalls: clients });

    const promise = svc.handleEvent({ event: 'escrow.funded', contractId: 'ghost' });

    await jest.advanceTimersByTimeAsync(8000);

    const result = await promise;
    expect(result).toEqual({ handled: false, reason: 'processing_failed' });
  });

  it('returns processing_failed when DB update consistently errors', async () => {
    const errClient = updateClient(null, { message: 'connection lost' });

    const svc = buildService({
      getClientCalls: [errClient, errClient, errClient, errClient],
    });

    const promise = svc.handleEvent({ event: 'escrow.funded', contractId: 'err' });

    await jest.advanceTimersByTimeAsync(8000);

    const result = await promise;
    expect(result).toEqual({ handled: false, reason: 'processing_failed' });
  });
});

// ---------------------------------------------------------------------------
// WebhooksController
// ---------------------------------------------------------------------------
describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: jest.Mocked<WebhooksService>;

  beforeEach(async () => {
    service = {
      verifySignature: jest.fn(),
      handleEvent: jest.fn(),
    } as unknown as jest.Mocked<WebhooksService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: service }],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
  });

  function req(body: string, sig = ''): Request & { rawBody: Buffer } {
    return {
      rawBody: Buffer.from(body),
      headers: { 'x-trustless-signature': sig },
    } as unknown as Request & { rawBody: Buffer };
  }

  it('throws 401 when x-trustless-signature header is absent', async () => {
    await expect(controller.handleTrustlessWork(req('{}'), '')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws 401 when signature verification fails', async () => {
    service.verifySignature.mockReturnValue(false);
    await expect(
      controller.handleTrustlessWork(req('{}', 'sha256=bad'), 'sha256=bad'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws 400 for malformed JSON payload', async () => {
    service.verifySignature.mockReturnValue(true);
    await expect(controller.handleTrustlessWork(req('not-json', 'sig'), 'sig')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws 400 when contractId is missing from payload', async () => {
    service.verifySignature.mockReturnValue(true);
    await expect(
      controller.handleTrustlessWork(req('{"event":"escrow.funded"}', 'sig'), 'sig'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 400 when event field is missing from payload', async () => {
    service.verifySignature.mockReturnValue(true);
    await expect(
      controller.handleTrustlessWork(req('{"contractId":"abc"}', 'sig'), 'sig'),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns { ok: true } for a valid funded event', async () => {
    service.verifySignature.mockReturnValue(true);
    service.handleEvent.mockResolvedValue({ handled: true });
    const result = await controller.handleTrustlessWork(
      req('{"event":"escrow.funded","contractId":"abc"}', 'sig'),
      'sig',
    );
    expect(result).toEqual({ ok: true, reason: undefined });
  });

  it('returns { ok: true } for milestone_updated event', async () => {
    service.verifySignature.mockReturnValue(true);
    service.handleEvent.mockResolvedValue({ handled: true });
    const result = await controller.handleTrustlessWork(
      req(
        '{"event":"escrow.milestone_updated","contractId":"abc","milestone":{"index":0,"status":"completed"}}',
        'sig',
      ),
      'sig',
    );
    expect(result).toEqual({ ok: true, reason: undefined });
  });

  it('returns { ok: true } for info event', async () => {
    service.verifySignature.mockReturnValue(true);
    service.handleEvent.mockResolvedValue({ handled: true });
    const result = await controller.handleTrustlessWork(
      req('{"event":"agreement.created","contractId":"abc"}', 'sig'),
      'sig',
    );
    expect(result).toEqual({ ok: true, reason: undefined });
  });

  it('returns { ok: false } for an unknown event type', async () => {
    service.verifySignature.mockReturnValue(true);
    service.handleEvent.mockResolvedValue({ handled: false, reason: 'unhandled_event_type' });
    const result = await controller.handleTrustlessWork(
      req('{"event":"escrow.paused","contractId":"abc"}', 'sig'),
      'sig',
    );
    expect(result).toEqual({ ok: false, reason: 'unhandled_event_type' });
  });

  it('returns { ok: false } when processing fails', async () => {
    service.verifySignature.mockReturnValue(true);
    service.handleEvent.mockResolvedValue({ handled: false, reason: 'processing_failed' });
    const result = await controller.handleTrustlessWork(
      req('{"event":"escrow.funded","contractId":"abc"}', 'sig'),
      'sig',
    );
    expect(result).toEqual({ ok: false, reason: 'processing_failed' });
  });
});
