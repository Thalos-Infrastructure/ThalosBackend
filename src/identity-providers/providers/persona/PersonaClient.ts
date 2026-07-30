import axios from 'axios';

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

  private async request(method: string, path: string, data?: unknown, queryParams?: Record<string, string>): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    if (queryParams) Object.keys(queryParams).forEach(k => url.searchParams.append(k, queryParams[k]));
    try {
      const res = await axios.request({ method, url: url.toString(), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` }, data, timeout: this.config.timeout || 30000 });
      return res.data;
    } catch (error: any) {
      if (error.response) throw new Error(`Persona API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      throw new Error(`Persona request failed: ${error.message}`);
    }
  }

  async createInquiry(data: unknown): Promise<unknown> { return await this.request('POST', '/inquiries', data); }
  async getInquiry(inquiryId: string): Promise<unknown> { return await this.request('GET', `/inquiries/${inquiryId}`); }
  async listInquiries(params?: Record<string, string>): Promise<unknown> { return await this.request('GET', '/inquiries', undefined, params); }
}
