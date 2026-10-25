import { ServiceUnavailableException } from '@nestjs/common';
import { LendaraClient } from './lendara.client';

/** Reach the private accessor without exporting it just for the test. */
const apiKeyOf = (client: LendaraClient): string =>
  (client as unknown as { apiKey: () => string }).apiKey();

describe('LendaraClient — which API key it uses', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  it('prefers the configured key', () => {
    process.env.LENDARA_API_KEY = 'lnd_live_configured';
    process.env.STELLAR_NETWORK = 'testnet';

    expect(apiKeyOf(new LendaraClient())).toBe('lnd_live_configured');
  });

  it('ignores a blank variable rather than sending an empty key', () => {
    process.env.LENDARA_API_KEY = '   ';
    process.env.STELLAR_NETWORK = 'testnet';

    expect(apiKeyOf(new LendaraClient())).toMatch(/^lnd_test_/);
  });

  it('falls back to the sandbox key on testnet, and says so once', () => {
    delete process.env.LENDARA_API_KEY;
    process.env.STELLAR_NETWORK = 'testnet';

    const client = new LendaraClient();
    const warn = jest
      .spyOn((client as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    expect(apiKeyOf(client)).toMatch(/^lnd_test_/);
    apiKeyOf(client);
    apiKeyOf(client);

    // Warned, but not on every single request.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('refuses to fall back on mainnet', () => {
    // A sandbox project there would point real users at simulated money.
    delete process.env.LENDARA_API_KEY;
    process.env.STELLAR_NETWORK = 'mainnet';

    expect(() => apiKeyOf(new LendaraClient())).toThrow(ServiceUnavailableException);
  });

  it("treats 'public' as mainnet too", () => {
    delete process.env.LENDARA_API_KEY;
    process.env.STELLAR_NETWORK = 'public';

    expect(() => apiKeyOf(new LendaraClient())).toThrow(ServiceUnavailableException);
  });
});
