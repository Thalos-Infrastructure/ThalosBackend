export interface VeriffConfig {
  apiKey: string;
  apiSecret?: string;
  baseUrl?: string;
  timeout?: number;
}

export class VeriffClient {
  private config: VeriffConfig;
  private baseUrl: string;

  constructor(config: VeriffConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.veriff.com/v1';
  }

  private async request(method: string, path: string, data?: unknown): Promise<unknown> {
    if (!this.config.apiSecret) throw new Error('Veriff apiSecret is required');
    const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64');
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    };
    const res = await fetch(`${this.baseUrl}${path}`, opts);
    if (!res.ok) throw new Error(`Veriff API error: ${res.status} - ${await res.text()}`);
    return await res.json();
  }

  async createSession(data: unknown): Promise<unknown> {
    return await this.request('POST', '/sessions', data);
  }
  async getSession(sessionId: string): Promise<unknown> {
    return await this.request('GET', `/sessions/${sessionId}`);
  }
  async getSessionDecision(sessionId: string): Promise<unknown> {
    return await this.request('GET', `/sessions/${sessionId}/decision`);
  }
}
