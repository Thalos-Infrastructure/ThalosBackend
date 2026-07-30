export interface AlloyConfig {
  apiKey: string;
  apiUrl?: string;
  timeout?: number;
}

export class AlloyClient {
  private config: AlloyConfig;
  private baseUrl: string;

  constructor(config: AlloyConfig) {
    this.config = config;
    this.baseUrl = config.apiUrl || 'https://sandbox.alloy.co/v1';
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
    const res = await fetch(`${this.baseUrl}${path}`, opts);
    if (!res.ok) throw new Error(`Alloy API error: ${res.status} - ${await res.text()}`);
    return await res.json();
  }

  async createEvaluation(data: unknown): Promise<unknown> {
    return await this.request('POST', '/evaluations', data);
  }
  async getEvaluation(evaluationId: string): Promise<unknown> {
    return await this.request('GET', `/evaluations/${evaluationId}`);
  }
  async cancelEvaluation(evaluationId: string): Promise<unknown> {
    return await this.request('POST', `/evaluations/${evaluationId}/cancel`);
  }
}
