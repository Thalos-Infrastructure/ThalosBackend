import axios from 'axios';

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
    try {
      const res = await axios.request({ method, url: `${this.baseUrl}${path}`, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` }, data, timeout: this.config.timeout || 30000 });
      return res.data;
    } catch (error: any) {
      if (error.response) throw new Error(`Synaps API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      throw new Error(`Synaps request failed: ${error.message}`);
    }
  }

  async createSession(data: unknown): Promise<unknown> { return await this.request('POST', '/session', data); }
  async getSession(sessionId: string): Promise<unknown> { return await this.request('GET', `/session/${sessionId}`); }
  async updateSession(sessionId: string, data: unknown): Promise<unknown> { return await this.request('PUT', `/session/${sessionId}`, data); }
}
