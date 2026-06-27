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

  // Each item in getClientCalls is the resolved value returned by that getClient() invocation
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
// handleEvent — happy paths
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

  it('escrow.disputed → disputed: updates DB and calls notifyDisputeOpened', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    const result = await svc.handleEvent({ event: 'escrow.disputed', contractId: 'c-3' });
    expect(result).toEqual({ handled: true });
    expect(svc._notifyDispute).toHaveBeenCalledWith(
      expect.objectContaining({ agreementId: 'agr-1' }),
    );
  });

  it('funded path does not emit completed or call notifyDisputeOpened', async () => {
    const svc = buildService({ getClientCalls: [updateClient(row), insertClient()] });
    await svc.handleEvent({ event: 'escrow.funded', contractId: 'c-1' });
    expect(svc._emit).not.toHaveBeenCalledWith('agreement.completed', expect.anything());
    expect(svc._notifyDispute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleEvent — idempotency (atomic guard)
// ---------------------------------------------------------------------------
describe('WebhooksService.handleEvent — idempotency', () => {
  it('returns already_applied when atomic UPDATE finds status already matches', async () => {
    // UPDATE with .neq('status', 'funded') returns null → status already funded
    const existing = { id: 'agr-2', status: 'funded' };
    const svc = buildService({ getClientCalls: [updateClient(null), selectClient(existing)] });
    const result = await svc.handleEvent({ event: 'escrow.funded', contractId: 'dup' });
    expect(result).toEqual({ handled: true, reason: 'already_applied' });
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
// handleEvent — edge cases
// ---------------------------------------------------------------------------
describe('WebhooksService.handleEvent — edge cases', () => {
  it('returns unhandled_event_type for unknown events without touching DB', async () => {
    const svc = buildService();
    const result = await svc.handleEvent({ event: 'escrow.paused', contractId: 'x' });
    expect(result).toEqual({ handled: false, reason: 'unhandled_event_type' });
  });

  it('returns agreement_not_found when contractId matches no row', async () => {
    // Atomic UPDATE returns null, fallback SELECT also returns null
    const svc = buildService({ getClientCalls: [updateClient(null), selectClient(null)] });
    const result = await svc.handleEvent({ event: 'escrow.funded', contractId: 'ghost' });
    expect(result).toEqual({ handled: false, reason: 'agreement_not_found' });
  });

  it('returns db_error when the UPDATE itself fails', async () => {
    const svc = buildService({
      getClientCalls: [updateClient(null, { message: 'connection lost' })],
    });
    const result = await svc.handleEvent({ event: 'escrow.funded', contractId: 'err' });
    expect(result).toEqual({ handled: false, reason: 'db_error' });
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

  it('returns { ok: true, reason: "already_applied" } for duplicate request', async () => {
    service.verifySignature.mockReturnValue(true);
    service.handleEvent.mockResolvedValue({ handled: true, reason: 'already_applied' });
    const result = await controller.handleTrustlessWork(
      req('{"event":"escrow.funded","contractId":"abc"}', 'sig'),
      'sig',
    );
    expect(result).toEqual({ ok: true, reason: 'already_applied' });
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
});
