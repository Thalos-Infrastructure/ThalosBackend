import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { IdentityProvidersService } from './identity-providers.service';
import { IdentityProvidersController } from './identity-providers.controller';
import { KYC_PROVIDER, KycStatus } from './interfaces/kyc-provider.interface';
import { IdentityConfigManager, IdentityProviderConfig } from './abstraction/IdentityConfigManager';
import { WebhookSecretGuard } from './webhook-secret.guard';

class MockKycProvider {
  readonly name = 'mock';
  // eslint-disable-next-line @typescript-eslint/require-await
  async createSession(input: { userId: string; metadata?: Record<string, unknown> }) {
    return {
      providerVerificationId: 'test-id',
      sessionUrl: 'https://example.com/session',
      metadata: { userId: input.userId },
    };
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatus(providerVerificationId: string) {
    return {
      status: KycStatus.VERIFIED,
      verifiedAt: '2024-01-01T00:00:00Z',
      metadata: { id: providerVerificationId },
    };
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async processWebhook(payload: unknown) {
    return {
      providerVerificationId: 'test-id',
      result: {
        status: KycStatus.VERIFIED,
        verifiedAt: null,
        metadata: payload as Record<string, unknown>,
      },
    };
  }
}

describe('IdentityProvidersService', () => {
  let service: IdentityProvidersService;
  let mockProvider: MockKycProvider;

  beforeEach(async () => {
    mockProvider = new MockKycProvider();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityProvidersService,
        {
          provide: KYC_PROVIDER,
          useValue: mockProvider,
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<IdentityProvidersService>(IdentityProvidersService);
  });

  it('should create a session', async () => {
    const result = await service.createSession('user-123', { firstName: 'John' });
    expect(result.providerVerificationId).toBe('test-id');
    expect(result.sessionUrl).toBe('https://example.com/session');
    expect(result.metadata).toEqual({ userId: 'user-123' });
  });

  it('should get status', async () => {
    const result = await service.getStatus('test-id');
    expect(result.status).toBe(KycStatus.VERIFIED);
    expect(result.verifiedAt).toBe('2024-01-01T00:00:00Z');
  });

  it('should process webhook', async () => {
    const payload = { test: 'data' };
    const result = await service.processWebhook(payload);
    expect(result.providerVerificationId).toBe('test-id');
    expect(result.result.status).toBe(KycStatus.VERIFIED);
  });
});

describe('IdentityProvidersController', () => {
  let controller: IdentityProvidersController;
  let mockService: jest.Mocked<IdentityProvidersService>;

  beforeEach(async () => {
    process.env.KYC_WEBHOOK_SECRET = 'test-webhook-secret';
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IdentityProvidersController],
      providers: [
        WebhookSecretGuard,
        {
          provide: IdentityProvidersService,
          useValue: {
            createSession: jest.fn(),
            getStatus: jest.fn(),
            processWebhook: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<IdentityProvidersController>(IdentityProvidersController);
    mockService = module.get(IdentityProvidersService);
  });

  describe('POST /identity-providers/session', () => {
    it('should create a session', async () => {
      const mockResponse = {
        providerVerificationId: 'test-id',
        sessionUrl: 'https://example.com',
      };
      mockService.createSession.mockResolvedValue(mockResponse);

      const result = await controller.createSession({ userId: 'user-123', metadata: {} });
      expect(result).toEqual(mockResponse);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockService.createSession).toHaveBeenCalledWith('user-123', {});
    });
  });

  describe('GET /identity-providers/status/:id', () => {
    it('should get status', async () => {
      const mockResponse = {
        status: KycStatus.VERIFIED,
        verifiedAt: '2024-01-01T00:00:00Z',
      };
      mockService.getStatus.mockResolvedValue(mockResponse);

      const result = await controller.getStatus('test-id');
      expect(result).toEqual(mockResponse);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockService.getStatus).toHaveBeenCalledWith('test-id');
    });
  });

  describe('POST /identity-providers/webhook', () => {
    it('should process webhook', async () => {
      const payload = { test: 'data' };
      const mockResponse = {
        providerVerificationId: 'test-id',
        result: { status: KycStatus.VERIFIED, verifiedAt: null },
      };
      mockService.processWebhook.mockResolvedValue(mockResponse);

      const result = await controller.processWebhook(payload);
      expect(result).toEqual(mockResponse);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockService.processWebhook).toHaveBeenCalledWith(payload);
    });
  });
});

describe('WebhookSecretGuard', () => {
  let guard: WebhookSecretGuard;

  beforeEach(() => {
    guard = new WebhookSecretGuard();
  });

  afterEach(() => {
    delete process.env.KYC_WEBHOOK_SECRET;
  });

  it('throws if KYC_WEBHOOK_SECRET not configured', () => {
    delete process.env.KYC_WEBHOOK_SECRET;
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    };
    expect(() => guard.canActivate(mockContext as never)).toThrow(
      'KYC_WEBHOOK_SECRET not configured',
    );
  });

  it('throws if header does not match', () => {
    process.env.KYC_WEBHOOK_SECRET = 'secret';
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-kyc-webhook-secret': 'wrong' } }),
      }),
    };
    expect(() => guard.canActivate(mockContext as never)).toThrow('Invalid webhook secret');
  });

  it('passes if header matches', () => {
    process.env.KYC_WEBHOOK_SECRET = 'secret';
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-kyc-webhook-secret': 'secret' } }),
      }),
    };
    expect(guard.canActivate(mockContext as never)).toBe(true);
  });
});

describe('IdentityConfigManager with constructor overload', () => {
  it('should accept IdentityProviderConfig directly', () => {
    const config: IdentityProviderConfig = {
      provider: 'sumsub',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      webhookSecret: 'webhook-secret',
      baseUrl: 'https://api.test.com',
      timeout: 30000,
      levelName: 'test-level',
    };

    const manager = new IdentityConfigManager(config);
    const result = manager.getConfig();

    expect(result.provider).toBe('sumsub');
    expect(result.apiKey).toBe('test-key');
    expect(result.apiSecret).toBe('test-secret');
    expect(result.webhookSecret).toBe('webhook-secret');
    expect(result.baseUrl).toBe('https://api.test.com');
    expect(result.timeout).toBe(30000);
    expect(result.levelName).toBe('test-level');
  });

  it('should accept env var object and parse it', () => {
    const env = {
      IDENTITY_PROVIDER: 'persona',
      IDENTITY_API_KEY: 'persona-key',
      IDENTITY_TIMEOUT: '15000',
    };

    const manager = new IdentityConfigManager(env);
    const result = manager.getConfig();

    expect(result.provider).toBe('persona');
    expect(result.apiKey).toBe('persona-key');
    expect(result.timeout).toBe(15000);
    expect(result.levelName).toBe('basic-kyc-level');
  });
});
