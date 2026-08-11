export interface PersonaConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export class PersonaClient {
  private config: PersonaConfig;
  private baseUrl: string;

  constructor(config: PersonaConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://withpersona.com/api/v1';
  }

  private async request(
    method: string,
    path: string,
    data?: unknown,
    queryParams?: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    if (queryParams)
      Object.keys(queryParams).forEach((k) => url.searchParams.append(k, queryParams[k]));
    const opts: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    };
    const res = await fetch(url.toString(), opts);
    if (!res.ok) throw new Error(`Persona API error: ${res.status} - ${await res.text()}`);
    return await res.json();
  }

  async createInquiry(data: unknown): Promise<unknown> {
    return await this.request('POST', '/inquiries', data);
  }
  async getInquiry(inquiryId: string): Promise<unknown> {
    return await this.request('GET', `/inquiries/${inquiryId}`);
  }
  async listInquiries(params?: Record<string, string>): Promise<unknown> {
    return await this.request('GET', '/inquiries', undefined, params);
  }
}
