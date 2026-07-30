import axios from 'axios';

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
    try {
      const res = await axios.request({ method, url: `${this.baseUrl}${path}`, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` }, data, timeout: this.config.timeout || 30000 });
      return res.data;
    } catch (error: any) {
      if (error.response) throw new Error(`Alloy API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      throw new Error(`Alloy request failed: ${error.message}`);
    }
  }

  async createEvaluation(data: unknown): Promise<unknown> { return await this.request('POST', '/evaluations', data); }
  async getEvaluation(evaluationId: string): Promise<unknown> { return await this.request('GET', `/evaluations/${evaluationId}`); }
  async cancelEvaluation(evaluationId: string): Promise<unknown> { return await this.request('POST', `/evaluations/${evaluationId}/cancel`); }
}
