export interface SynapsConfig {
  apiKey: string;
  apiUrl?: string;
  timeout?: number;
}

export class SynapsClient {
  private config: SynapsConfig;
  private baseUrl: string;

  constructor(config: SynapsConfig) {
    this.config = config;
    this.baseUrl = config.apiUrl || 'https://api.synaps.io/v2';
  }

  private async request(method: string, path: string, data?: unknown): Promise<unknown> {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    };
    const res = await fetch(`${this.baseUrl}${path}`, opts);
    if (!res.ok) throw new Error(`Synaps API error: ${res.status} - ${await res.text()}`);
    return await res.json();
  }

  async createSession(data: unknown): Promise<unknown> { return await this.request('POST', '/session', data); }
  async getSession(sessionId: string): Promise<unknown> { return await this.request('GET', `/session/${sessionId}`); }
  async updateSession(sessionId: string, data: unknown): Promise<unknown> { return await this.request('PUT', `/session/${sessionId}`, data); }
}
