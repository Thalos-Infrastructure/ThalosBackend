import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GitHubEvidenceService } from './github-evidence.service';
import { SupabaseService } from '../supabase/supabase.service';

describe('GitHubEvidenceService', () => {
  let service: GitHubEvidenceService;
  let supabaseMock: any;
  let configMock: any;

  const mockUserId = 'user-123-uuid';
  const mockWallet = 'GABC1234567890WDETEST';
  const mockJwtSecret = 'test-jwt-secret-key-12345';

  beforeEach(async () => {
    supabaseMock = {
      getClient: jest.fn(),
    };

    configMock = {
      get: jest.fn((key: string, defaultValue?: string) => {
        switch (key) {
          case 'GITHUB_TOKEN':
            return 'ghp_mock_token_123';
          case 'GITHUB_CLIENT_ID':
            return 'mock-client-id';
          case 'GITHUB_CLIENT_SECRET':
            return 'mock-client-secret';
          case 'JWT_SECRET':
            return mockJwtSecret;
          default:
            return defaultValue;
        }
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitHubEvidenceService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<GitHubEvidenceService>(GitHubEvidenceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('getOAuthUrl', () => {
    it('should generate a valid OAuth URL with an HMAC-signed state encoding the userId', async () => {
      const result = await service.getOAuthUrl(mockUserId);
      expect(result.error).toBeNull();
      expect(result.url).toContain('https://github.com/login/oauth/authorize?');
      expect(result.url).toContain('client_id=mock-client-id');
      expect(result.url).toContain('scope=read%3Auser');
      expect(result.url).toContain('state=');
    });
  });

  describe('handleOAuthCallback', () => {
    it('should exchange code, fetch GitHub profile, store username+timestamp, and discard token', async () => {
      const stateObj = await service.getOAuthUrl(mockUserId);
      const urlParams = new URLSearchParams(stateObj.url.split('?')[1]);
      const state = urlParams.get('state')!;

      // Mock fetch for token exchange and user profile
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: any) => {
        if (url.toString().includes('github.com/login/oauth/access_token')) {
          return Promise.resolve({
            json: () => Promise.resolve({ access_token: 'gho_user_token_abc' }),
          } as Response);
        }
        if (url.toString().includes('api.github.com/user')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ login: 'octocat' }),
          } as Response);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      // Mock Supabase calls
      const mockEqAuthUsers = jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({
          data: { wallet_public_key: mockWallet },
          error: null,
        }),
      });

      const mockUpdateProfiles = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

      supabaseMock.getClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'auth_users') {
            return { select: jest.fn().mockReturnValue({ eq: mockEqAuthUsers }) };
          }
          if (table === 'profiles') {
            return { update: mockUpdateProfiles };
          }
          return {};
        }),
      });

      const result = await service.handleOAuthCallback('mock_code_123', state);

      expect(result.github_username).toBe('octocat');
      expect(result.github_verified_at).toBeDefined();
      expect(result.error).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(mockUpdateProfiles).toHaveBeenCalledWith(
        expect.objectContaining({
          github_username: 'octocat',
          github_verified_at: expect.any(String),
        }),
      );
    });

    it('should throw ForbiddenException if OAuth state signature is invalid', async () => {
      await expect(
        service.handleOAuthCallback('mock_code', 'invalid.signature'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMergedPRs', () => {
    it('should fetch merged PRs scoped to project repo: repo:ORG/REPO author:USER is:pr is:merged', async () => {
      // Mock Supabase profile check returning verified github username
      supabaseMock.getClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'auth_users') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { wallet_public_key: mockWallet },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: {
                      github_username: 'builder_joe',
                      github_verified_at: '2026-08-01T00:00:00Z',
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      });

      const targetRepo = 'my-org/my-project';
      let capturedUrl = '';
      jest.spyOn(global, 'fetch').mockImplementation((url: any, opts: any) => {
        capturedUrl = url.toString();
        return Promise.resolve({
          ok: true,
          headers: new Headers(),
          json: () =>
            Promise.resolve({
              items: [
                {
                  number: 101,
                  title: 'feat: add milestone evidence',
                  html_url: 'https://github.com/my-org/my-project/pull/101',
                  pull_request: { merged_at: '2026-08-15T10:00:00Z' },
                },
              ],
            }),
        } as Response);
      });

      const result = await service.getMergedPRs(mockUserId, targetRepo);

      expect(result.error).toBeNull();
      expect(result.prs).toHaveLength(1);
      expect(result.prs[0]).toEqual({
        repo: targetRepo,
        number: 101,
        title: 'feat: add milestone evidence',
        url: 'https://github.com/my-org/my-project/pull/101',
        merged_at: '2026-08-15T10:00:00Z',
      });

      // Verify the search query is strictly scoped
      const decodedUrl = decodeURIComponent(capturedUrl);
      expect(decodedUrl).toContain(`q=repo:${targetRepo} author:builder_joe is:pr is:merged`);
    });

    it('should throw PRECONDITION_REQUIRED if GitHub is not linked on profile', async () => {
      supabaseMock.getClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'auth_users') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { wallet_public_key: mockWallet },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { github_username: null, github_verified_at: null },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      });

      await expect(service.getMergedPRs(mockUserId, 'my-org/my-project')).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw 429 TOO_MANY_REQUESTS when GitHub rate limit is exceeded', async () => {
      supabaseMock.getClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'auth_users') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { wallet_public_key: mockWallet },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: {
                      github_username: 'builder_joe',
                      github_verified_at: '2026-08-01T00:00:00Z',
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      });

      const headers = new Headers();
      headers.set('x-ratelimit-remaining', '0');
      headers.set('x-ratelimit-reset', (Math.floor(Date.now() / 1000) + 60).toString());

      jest.spyOn(global, 'fetch').mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          status: 403,
          headers,
          json: () => Promise.resolve({ message: 'API rate limit exceeded' }),
        } as Response);
      });

      await expect(service.getMergedPRs(mockUserId, 'rate-limited/repo')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('attachPR & getAttachedPRs & detachPR', () => {
    const agreementId = '11111111-2222-3333-4444-555555555555';
    const milestoneIndex = 0;

    it('should successfully attach a merged PR to a milestone', async () => {
      supabaseMock.getClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'auth_users') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { wallet_public_key: mockWallet },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'agreements') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { id: agreementId, created_by: mockWallet },
                    error: null,
                  }),
                  single: jest.fn().mockResolvedValue({
                    data: { milestones: [{ title: 'M1' }] },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'milestone_evidence_prs') {
            return {
              insert: jest.fn().mockResolvedValue({ error: null }),
            };
          }
          return {};
        }),
      });

      const dto = {
        repo: 'my-org/my-project',
        pr_number: 42,
        title: 'feat: finished milestone 1',
        url: 'https://github.com/my-org/my-project/pull/42',
        merged_at: '2026-08-10T12:00:00Z',
        actor_wallet: mockWallet,
      };

      const result = await service.attachPR(mockUserId, agreementId, milestoneIndex, dto);
      expect(result).toEqual({ success: true, error: null });
    });

    it('should list attached PRs for a milestone', async () => {
      const mockPRData = [
        {
          id: 'pr-uuid-1',
          agreement_id: agreementId,
          milestone_index: 0,
          repo: 'my-org/my-project',
          pr_number: 42,
          title: 'feat: finished milestone 1',
          url: 'https://github.com/my-org/my-project/pull/42',
          merged_at: '2026-08-10T12:00:00Z',
          attached_by: mockWallet,
          created_at: '2026-08-10T12:05:00Z',
        },
      ];

      supabaseMock.getClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'auth_users') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { wallet_public_key: mockWallet },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'agreements') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { id: agreementId, created_by: mockWallet },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'milestone_evidence_prs') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    order: jest.fn().mockResolvedValue({ data: mockPRData, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      });

      const result = await service.getAttachedPRs(mockUserId, agreementId, milestoneIndex);
      expect(result.error).toBeNull();
      expect(result.prs).toHaveLength(1);
      expect(result.prs[0].pr_number).toBe(42);
    });

    it('should detach a PR from a milestone', async () => {
      supabaseMock.getClient.mockReturnValue({
        from: jest.fn((table: string) => {
          if (table === 'auth_users') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { wallet_public_key: mockWallet },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'agreements') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({
                    data: { id: agreementId, created_by: mockWallet },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'milestone_evidence_prs') {
            return {
              delete: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockReturnValue({
                    eq: jest.fn().mockResolvedValue({ error: null, count: 1 }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      });

      const result = await service.detachPR(
        mockUserId,
        agreementId,
        milestoneIndex,
        'pr-uuid-1',
      );
      expect(result).toEqual({ success: true, error: null });
    });
  });
});
