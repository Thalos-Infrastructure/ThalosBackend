import { BadRequestException } from '@nestjs/common';
import { KycService } from './kyc.service';
import { CreateKycSessionDto } from './dto/kyc.dto';

// ---------------------------------------------------------------------------
// Chainable Supabase mock
// ---------------------------------------------------------------------------
function chainMock(data: unknown, error: unknown = null) {
  const obj: Record<string, jest.Mock> = {};
  ['from', 'select', 'eq', 'insert', 'update', 'upsert', 'neq'].forEach((m) => {
    obj[m] = jest.fn().mockReturnValue(obj);
  });
  obj.maybeSingle = jest.fn().mockResolvedValue({ data, error });
  obj.single = jest.fn().mockResolvedValue({ data, error });
  return obj;
}

interface BuildOpts {
  getClientCalls?: Array<unknown>;
  providerStatus?: string;
  verificationStatus?: string;
}

function buildService(opts: BuildOpts = {}) {
  const calls = opts.getClientCalls ?? [];
  let callIndex = 0;
  const getClient = jest.fn().mockImplementation(() => calls[callIndex++]);
  const supabase = { getClient };

  const provider = {
    name: 'sumsub',
    createSession: jest.fn().mockResolvedValue({
      providerVerificationId: 'sess-1',
      sessionUrl: 'https://example.com/kyc',
      initialStatus: 'pending',
    }),
    getStatus: jest.fn().mockResolvedValue({
      status: opts.providerStatus || 'verified',
      verifiedAt: new Date().toISOString(),
    }),
  };

  const verificationService = {
    getUserVerification: jest.fn().mockResolvedValue({
      subjectType: 'user',
      subjectId: 'user-1',
      isVerified: opts.verificationStatus === 'verified',
      status: opts.verificationStatus || 'unverified',
      level: 'none',
      provider: null,
      expiresAt: null,
      lastUpdated: null,
    }),
  };

  const svc = new (KycService as unknown as new (...args: unknown[]) => KycService)(
    supabase,
    provider,
    verificationService,
  );

  return { svc, provider, getClient, verificationService };
}

const baseDto: CreateKycSessionDto = {
  metadata: { source: 'web' },
};

describe('KycService', () => {
  describe('createSession', () => {
    it('creates a new verification session if unverified', async () => {
      const { svc, provider } = buildService({
        getClientCalls: [chainMock(null)], // upsert returns data
        verificationStatus: 'unverified',
      });

      const res = await svc.createSession('user-1', baseDto);

      expect(provider.createSession).toHaveBeenCalledWith({
        userId: 'user-1',
        metadata: baseDto.metadata,
      });
      expect(res.sessionUrl).toBe('https://example.com/kyc');
    });

    it('returns existing session if pending', async () => {
      const { svc, provider } = buildService({
        verificationStatus: 'pending',
      });

      const res = await svc.createSession('user-1', baseDto);

      expect(provider.createSession).not.toHaveBeenCalled();
      expect(res.verification.status).toBe('pending');
    });

    it('returns existing session if verified', async () => {
      const { svc, provider } = buildService({
        verificationStatus: 'verified',
      });

      const res = await svc.createSession('user-1', baseDto);

      expect(provider.createSession).not.toHaveBeenCalled();
      expect(res.verification.status).toBe('verified');
    });

    it('throws on upsert error', async () => {
      const { svc } = buildService({
        getClientCalls: [chainMock(null, { message: 'DB Error' })],
        verificationStatus: 'unverified',
      });

      await expect(svc.createSession('user-1', baseDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStatus', () => {
    it('returns aggregate verification status', async () => {
      const { svc } = buildService({ verificationStatus: 'verified' });
      const res = await svc.getStatus('user-1');
      expect(res.verification.status).toBe('verified');
    });

    it('syncs with provider if aggregate is pending', async () => {
      const { svc, provider } = buildService({
        verificationStatus: 'pending',
        getClientCalls: [
          chainMock({ id: 'rec-1', status: 'pending', provider_reference: 'sess-1' }), // select pending record
          chainMock(null), // update record
        ],
        providerStatus: 'verified',
      });

      await svc.getStatus('user-1');
      expect(provider.getStatus).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('handleWebhookProcessed', () => {
    it('updates verification record based on webhook payload', async () => {
      const { svc, getClient } = buildService({ getClientCalls: [chainMock([{ id: 'rec-1' }])] });
      await svc.handleWebhookProcessed({
        providerVerificationId: 'sess-1',
        result: { status: 'verified', verifiedAt: new Date().toISOString() },
      });
      expect(getClient).toHaveBeenCalled();
    });
  });
});
