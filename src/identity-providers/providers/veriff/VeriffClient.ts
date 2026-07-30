import axios from 'axios';

export interface VeriffConfig {
  apiKey: string;
  apiSecret: string;
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
    const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64');
    try {
      const res = await axios.request({ method, url: `${this.baseUrl}${path}`, headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` }, data, timeout: this.config.timeout || 30000 });
      return res.data;
    } catch (error: any) {
      if (error.response) throw new Error(`Veriff API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      throw new Error(`Veriff request failed: ${error.message}`);
    }
  }

  async createSession(data: unknown): Promise<unknown> { return await this.request('POST', '/sessions', data); }
  async getSession(sessionId: string): Promise<unknown> { return await this.request('GET', `/sessions/${sessionId}`); }
  async getSessionDecision(sessionId: string): Promise<unknown> { return await this.request('GET', `/sessions/${sessionId}/decision`); }
}
