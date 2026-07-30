export interface StripeConfig {
  apiKey: string;
  webhookSecret?: string;
  timeout?: number;
}

export class StripeClient {
  private config: StripeConfig;

  constructor(config: StripeConfig) {
    this.config = config;
  }

  private async request(method: string, path: string, data?: unknown): Promise<unknown> {
    const opts: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    };
    const res = await fetch(`https://api.stripe.com/v1${path}`, opts);
    if (!res.ok) throw new Error(`Stripe API error: ${res.status} - ${await res.text()}`);
    return await res.json();
  }

  async createVerificationSession(data: unknown): Promise<unknown> {
    return await this.request('POST', '/identity/verification_sessions', {
      type: 'individual',
      ...((data as Record<string, unknown>).metadata ?? {}),
    });
  }
  async retrieveVerificationSession(sessionId: string): Promise<unknown> {
    return await this.request('GET', `/identity/verification_sessions/${sessionId}`);
  }
  async cancelVerificationSession(sessionId: string): Promise<unknown> {
    return await this.request('POST', `/identity/verification_sessions/${sessionId}/cancel`);
  }
}
